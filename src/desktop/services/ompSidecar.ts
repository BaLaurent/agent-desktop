// omp binary sidecar lifecycle, ported from src/main/services/ompSidecar.ts. This module has NO
// dispatch handlers — the orchestrator awaits ensureOmpBinary() during startup. Electron swap:
// app.getPath('userData') → userDataDir() (../paths). ompLocator/ompRpcClient are already
// Electron-free; only the managed-binary path resolution needed the userData dir.
//
// Dev-first assumed omp on PATH. For packaged builds — and any machine without omp installed — this
// service downloads the platform omp binary on startup if absent, and on every startup checks GitHub
// releases for a NEWER release that is still WITHIN a pinned supported semver range. A breaking omp
// release (major bump) is intentionally NOT auto-installed: bumping SUPPORTED_OMP_RANGE is a
// deliberate, re-verified app change (the RPC frame shapes this backend parses are version-coupled).
//
// The managed binary lives under the userData dir and is registered as the locator's fallback
// (PATH / PI_OMP_PATH still win). All network/child-proc failures are non-fatal.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { setOmpFallbackPath } from "../../core/services/pi/ompLocator";
import { createLogger, errToCtx } from "../../core/utils/logger";
import { userDataDir } from "../paths";

const log = createLogger("ompSidecar");

const execFileP = promisify(execFile);

/** Pinned per app release. The running binary is v16.2.x; a major bump is opt-in. */
export const SUPPORTED_OMP_MIN = "16.2.0";
export const SUPPORTED_OMP_MAX_EXCLUSIVE = "17.0.0";

const REPO = "can1357/oh-my-pi";
const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh`;
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=20`;

// ─── pure semver helpers (fixed `>=MIN <MAX` range shape) ─────────────────────

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Parse an `x.y.z` string (leading `v` and pre-release/build suffixes tolerated). */
export function parseSemver(raw: string): Semver | null {
  const m = raw.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Extract the version from `omp --version` output (`omp/16.2.13`). */
export function parseVersionOutput(stdout: string): Semver | null {
  const m = stdout.match(/(\d+\.\d+\.\d+)/);
  return m ? parseSemver(m[1]) : null;
}

/** -1 / 0 / 1 comparison of two parsed semvers. */
export function cmpSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/** True when `v` is in `[SUPPORTED_OMP_MIN, SUPPORTED_OMP_MAX_EXCLUSIVE)`. */
export function isInSupportedRange(v: Semver): boolean {
  const min = parseSemver(SUPPORTED_OMP_MIN)!;
  const max = parseSemver(SUPPORTED_OMP_MAX_EXCLUSIVE)!;
  return cmpSemver(v, min) >= 0 && cmpSemver(v, max) < 0;
}

/**
 * From a list of release tags, return the highest one within the supported
 * range as `{ tag, version }`, or null when none qualify.
 */
export function pickLatestInRange(tags: string[]): { tag: string; version: Semver } | null {
  let best: { tag: string; version: Semver } | null = null;
  for (const tag of tags) {
    const version = parseSemver(tag);
    if (!version || !isInSupportedRange(version)) continue;
    if (!best || cmpSemver(version, best.version) > 0) best = { tag, version };
  }
  return best;
}

export type OmpBinaryAction =
  | { kind: "use-path" }
  | { kind: "use-managed" }
  | { kind: "install"; tag: string }
  | { kind: "update"; tag: string }
  | { kind: "none" };

/**
 * Pure decision: given the version resolved on PATH/PI_OMP_PATH (if any), the
 * managed binary's version (if present), and the latest in-range release, decide
 * what to do. Prefers an in-range PATH binary (don't manage the user's install);
 * otherwise install/update the managed one to the latest in-range release; a
 * managed binary that is already newest-in-range is a no-op.
 */
export function decideOmpAction(inputs: {
  pathVersion: Semver | null;
  managedVersion: Semver | null;
  latestInRange: { tag: string; version: Semver } | null;
}): OmpBinaryAction {
  const { pathVersion, managedVersion, latestInRange } = inputs;

  // A usable PATH/override binary that is in range → use it, never manage.
  if (pathVersion && isInSupportedRange(pathVersion)) return { kind: "use-path" };

  if (!managedVersion) {
    // No managed binary yet: install the latest in-range release if we found one.
    return latestInRange ? { kind: "install", tag: latestInRange.tag } : { kind: "none" };
  }

  // Managed binary exists: update only to a NEWER in-range release.
  if (latestInRange && cmpSemver(latestInRange.version, managedVersion) > 0) {
    return { kind: "update", tag: latestInRange.tag };
  }
  return { kind: "use-managed" };
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

function managedBinaryPath(): string {
  return join(userDataDir(), "omp-bin", "omp");
}

/** Run `<bin> --version` and parse it; null on any failure. */
async function readBinaryVersion(bin: string): Promise<Semver | null> {
  try {
    const { stdout } = await execFileP(bin, ["--version"], { timeout: 10_000 });
    return parseVersionOutput(stdout);
  } catch {
    return null;
  }
}

/** Fetch recent release tags from GitHub; [] on any failure. */
async function fetchReleaseTags(): Promise<string[]> {
  try {
    const res = await fetch(RELEASES_URL, { headers: { "User-Agent": "agent-desktop" } });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return [];
    const tags: string[] = [];
    for (const entry of body) {
      if (entry && typeof entry === "object" && "tag_name" in entry) {
        const tag = entry.tag_name;
        if (typeof tag === "string") tags.push(tag);
      }
    }
    return tags;
  } catch (err) {
    log.warn("failed to fetch omp release tags", errToCtx(err));
    return [];
  }
}

/**
 * Download the given release tag's binary into the managed dir via the official
 * install script (`--binary --ref <tag>`, honoring PI_INSTALL_DIR). Returns true
 * on success.
 */
async function installManagedBinary(tag: string): Promise<boolean> {
  // A GitHub release tag is `v<semver>` — reject anything else before shelling out.
  if (!/^v?\d+\.\d+\.\d+$/.test(tag)) {
    log.warn("refusing to install unexpected omp tag", { tag });
    return false;
  }
  const dir = dirname(managedBinaryPath());
  try {
    await execFileP(
      "sh",
      ["-c", `curl -fsSL ${INSTALL_SCRIPT_URL} | sh -s -- --binary --ref ${tag}`],
      { timeout: 120_000, env: { ...process.env, PI_INSTALL_DIR: dir } },
    );
    return existsSync(managedBinaryPath());
  } catch (err) {
    log.warn("omp binary install failed", errToCtx(err));
    return false;
  }
}

/**
 * Ensure a usable, in-range omp binary is available and register the managed
 * fallback path with the locator. Non-blocking-safe: awaited during startup but
 * never throws (all failures degrade to log + continue).
 */
export async function ensureOmpBinary(): Promise<void> {
  // The install script is a POSIX sh script (curl | sh) — Linux/macOS only.
  // On other platforms we do not manage a binary; PATH/PI_OMP_PATH still resolve.
  if (process.platform !== "linux" && process.platform !== "darwin") {
    log.info("omp sidecar management skipped on this platform", { platform: process.platform });
    return;
  }

  const managed = managedBinaryPath();
  // Register the managed path up-front so the locator can fall back to it even
  // if the update/version probes below fail.
  if (existsSync(managed)) setOmpFallbackPath(managed);

  try {
    const override = process.env.PI_OMP_PATH;
    const [pathVersion, managedVersion, tags] = await Promise.all([
      readBinaryVersion(override || "omp"),
      existsSync(managed) ? readBinaryVersion(managed) : Promise.resolve(null),
      fetchReleaseTags(),
    ]);
    const latestInRange = pickLatestInRange(tags);
    const action = decideOmpAction({ pathVersion, managedVersion, latestInRange });

    switch (action.kind) {
      case "use-path":
        // An in-range PATH/PI_OMP_PATH binary wins — clear any managed fallback
        // so the locator resolves the user's install, not a stale managed one.
        setOmpFallbackPath(null);
        log.info("using omp on PATH/PI_OMP_PATH (in supported range)", {
          version: pathVersion ? `${pathVersion.major}.${pathVersion.minor}.${pathVersion.patch}` : "unknown",
        });
        return;
      case "install": {
        log.info("installing managed omp binary", { tag: action.tag });
        if (await installManagedBinary(action.tag)) {
          setOmpFallbackPath(managed);
          log.info("managed omp binary installed", { path: managed, tag: action.tag });
        }
        return;
      }
      case "update": {
        log.info("updating managed omp binary to newer in-range release", { tag: action.tag });
        if (await installManagedBinary(action.tag)) {
          setOmpFallbackPath(managed);
          log.info("managed omp binary updated", { path: managed, tag: action.tag });
        }
        return;
      }
      case "use-managed":
        setOmpFallbackPath(managed);
        log.info("using managed omp binary (already newest in range)", {
          path: managed,
          version: managedVersion ? `${managedVersion.major}.${managedVersion.minor}.${managedVersion.patch}` : "unknown",
        });
        return;
      case "none":
        log.warn("no in-range omp binary available (PATH absent/out-of-range, no in-range release found)");
        return;
    }
  } catch (err) {
    log.warn("ensureOmpBinary failed (non-fatal)", errToCtx(err));
  }
}
