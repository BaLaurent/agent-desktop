// Path resolution for the deno desktop shell — replaces Electron's `app.getPath`,
// `app.getVersion`, `app.isPackaged`, and `process.resourcesPath`.
//
// IMPORTANT (verified in the Phase-0 spike): under `deno desktop`, `import.meta.url`
// maps into the compiled VFS (`/tmp/deno-compile-laufey/...`) EVEN under `--hmr`.
// So resource paths resolve differently for dev vs packaged:
//   - packaged  -> embedded VFS, `import.meta.url`-relative (files added with --include)
//   - dev       -> real on-disk repo root via `Deno.cwd()`
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Electron app name was `agent-desktop`; keep these paths byte-identical so existing
// user data (agent.db, error-buffer.json, settings) is picked up unchanged.
export function userDataDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "";
  switch (Deno.build.os) {
    case "darwin":
      return join(home, "Library", "Application Support", "agent-desktop");
    case "windows":
      return join(Deno.env.get("APPDATA") ?? join(home, "AppData", "Roaming"), "agent-desktop");
    default: {
      const xdg = Deno.env.get("XDG_CONFIG_HOME");
      return join(xdg && xdg.length > 0 ? xdg : join(home, ".config"), "agent-desktop");
    }
  }
}

// Dev-vs-packaged signal. `Deno.desktopVersion` is NOT usable: it is set to the deno.json
// version under BOTH `--hmr` and packaged builds, and `import.meta.url` resolves into the
// compile VFS under `--hmr` too (both verified in the Phase-0 spike). The dev loop launches
// with AGENT_DEV=1 (see package.json "dev" / dev-desktop.mjs) — the explicit env is the contract.
function isDev(): boolean {
  return Deno.env.get("AGENT_DEV") === "1";
}

export function appVersion(): string {
  return Deno.desktopVersion ?? "0.18.0-dev";
}

export function isPackaged(): boolean {
  return !isDev();
}

// Resolve a repo-relative resource (e.g. "resources/hotword-models/x.onnx", "build/trayLight.png").
// Dev: real on-disk repo root via Deno.cwd(). Packaged: embedded VFS via import.meta.url
// (files must be added at build time with --include build --include resources).
export function resourcePath(rel: string): string {
  if (isDev()) {
    return join(Deno.cwd(), rel);
  }
  return fileURLToPath(new URL("../../" + rel, import.meta.url));
}

// ─── VFS → disk materialization ─────────────────────────────────────────────
// External processes (the node STT sidecar, cron/systemd taskRunner entries) CANNOT read deno's
// compiled VFS — dlopen/execve/open all fail on /tmp/deno-compile-* paths. Resources such
// processes need are copied ONCE from the VFS to a real, version-keyed directory under userData;
// in dev the repo path is returned as-is (no copy). The version key invalidates the cache across
// app updates; older version dirs are pruned best-effort. The copy lands under a .partial name
// and is renamed into place so a crash mid-copy never leaves a truthy-but-broken cache entry.

function copyTreeSync(src: string, dest: string): void {
  const info = Deno.statSync(src);
  if (info.isDirectory) {
    Deno.mkdirSync(dest, { recursive: true });
    for (const entry of Deno.readDirSync(src)) {
      copyTreeSync(join(src, entry.name), join(dest, entry.name));
    }
    return;
  }
  Deno.mkdirSync(dirname(dest), { recursive: true });
  Deno.copyFileSync(src, dest);
}

export function materializeResource(rel: string): string {
  if (!isPackaged()) return join(Deno.cwd(), rel);
  const root = join(userDataDir(), "materialized");
  const versionRoot = join(root, appVersion());
  const dest = join(versionRoot, rel);
  try {
    Deno.statSync(dest);
    return dest; // already materialized for this app version
  } catch {
    // not yet materialized — fall through to the copy
  }
  const partial = dest + ".partial";
  try {
    Deno.removeSync(partial, { recursive: true });
  } catch {
    // no stale partial to clear
  }
  copyTreeSync(resourcePath(rel), partial);
  Deno.renameSync(partial, dest);
  // Prune caches left by previous app versions (best-effort).
  try {
    for (const entry of Deno.readDirSync(root)) {
      if (entry.name !== appVersion()) {
        Deno.removeSync(join(root, entry.name), { recursive: true });
      }
    }
  } catch {
    // pruning is opportunistic
  }
  return dest;
}
