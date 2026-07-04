// Ported from src/main/services/updater.ts. Strategy (decided): poll the GitHub releases API,
// compare the latest tag to the running version, and route the user to the release page in
// their browser rather than doing an in-app auto-download. electron-updater/autoUpdater are
// gone — deno desktop has no equivalent bsdiff pipeline yet (that path is deferred to the
// backlog). The `updates:*` channel names and the UpdateStatus/UpdateInfo shapes are preserved
// so the renderer settings UI (AboutSection) is untouched.
import type { HandleRegistrar } from "../../core/dispatch";
import type { UpdateInfo, UpdateStatus } from "../../shared/types";
import { broadcast } from "../../core/utils/broadcast";
import { createLogger } from "../../core/utils/logger";
import { appVersion } from "../paths";
import { openExternal } from "./opener";

const log = createLogger("updater");

const RELEASES_API = "https://api.github.com/repos/BaLaurent/agent-desktop/releases/latest";
const RELEASES_PAGE = "https://github.com/BaLaurent/agent-desktop/releases/latest";
const CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Minimal shape of the GitHub "latest release" payload we depend on.
interface GithubRelease {
  tag_name: string;
  html_url: string;
  published_at?: string;
}

let lastStatus: UpdateStatus = { state: "idle" };
// Where the "Download"/"Install" actions send the user; refreshed on every successful check.
let latestReleaseUrl = RELEASES_PAGE;
let timersStarted = false;

function sendStatus(status: UpdateStatus): void {
  lastStatus = status;
  broadcast("updates:status", status);
}

function isGithubRelease(value: unknown): value is GithubRelease {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.tag_name === "string" && typeof rec.html_url === "string";
}

// Split a version string into numeric components, dropping a leading "v" and any
// prerelease/build suffix (e.g. "v0.18.0-dev" -> [0, 18, 0]).
function versionParts(version: string): number[] {
  const core = version.replace(/^v/i, "").split("-")[0].split("+")[0];
  return core.split(".").map((part) => {
    const n = parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

// >0 when `a` is newer than `b`, <0 when older, 0 when equal.
function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchLatestRelease(): Promise<GithubRelease | null> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { "Accept": "application/vnd.github+json", "User-Agent": "agent-desktop" },
    });
    if (!res.ok) {
      log.debug("update check: non-OK response", { status: res.status });
      return null;
    }
    const body: unknown = await res.json();
    if (!isGithubRelease(body)) {
      log.debug("update check: unexpected response shape");
      return null;
    }
    return body;
  } catch (err) {
    log.debug("update check failed", { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// Shared by the manual `updates:check` channel and the passive interval. Broadcasts the
// resulting UpdateStatus and returns the UpdateInfo the renderer's check() call expects.
async function runCheck(): Promise<UpdateInfo> {
  sendStatus({ state: "checking" });
  const release = await fetchLatestRelease();
  if (!release) {
    sendStatus({ state: "not-available" });
    return { available: false };
  }
  latestReleaseUrl = release.html_url;
  const remoteVersion = release.tag_name.replace(/^v/i, "");
  const available = compareVersions(remoteVersion, appVersion()) > 0;
  if (!available) {
    sendStatus({ state: "not-available" });
    return { available: false, version: remoteVersion, releaseDate: release.published_at };
  }
  sendStatus({ state: "available", version: remoteVersion, releaseDate: release.published_at });
  try {
    new Notification("Update Available", { body: `Version ${remoteVersion} is available` });
  } catch {
    // Notification unavailable (no display / permission) — the status broadcast still informs the UI.
  }
  return { available: true, version: remoteVersion, releaseDate: release.published_at };
}

function startPassiveChecks(): void {
  if (timersStarted) return;
  timersStarted = true;
  // First check shortly after launch, then every 4h — mirrors the Electron autoUpdater cadence
  // so the renderer's onStatus subscription surfaces updates without a manual click.
  setTimeout(() => void runCheck(), CHECK_DELAY_MS);
  setInterval(() => void runCheck(), CHECK_INTERVAL_MS);
}

export function registerHandlers(dispatch: HandleRegistrar, _db: unknown): void {
  dispatch.handle("updates:check", async (): Promise<UpdateInfo> => runCheck());

  // "Download" (from the `available` state) and "Install" both open the GitHub release page in
  // the user's browser — there is no in-app download under deno desktop.
  dispatch.handle("updates:download", async () => {
    openExternal(latestReleaseUrl);
  });
  dispatch.handle("updates:install", async () => {
    openExternal(latestReleaseUrl);
  });

  dispatch.handle("updates:getStatus", async (): Promise<UpdateStatus> => lastStatus);

  startPassiveChecks();
}
