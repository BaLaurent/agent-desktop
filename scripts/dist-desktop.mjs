#!/usr/bin/env node
// Package the deno desktop shell into a distributable (.AppImage / .app / .msi).
//
// Embed model (verified empirically, incl. the build manifest): `deno desktop` embeds the module
// graph reachable from src/desktop/main.ts + the npm packages it resolves + the dirs named by
// --include + EVERY nested node_modules tree under cwd (auto-embedded for npm resolution; pruned
// below via --exclude). Other cwd content (untracked junk, .env.local, ssl/, config/) is NOT
// embedded — verified by binary secret-scans with positive controls.
//
// --include set:
//   out/renderer            built UI, served by uiServer from the VFS
//   out/headless            scheduler taskRunner; extracted VFS→disk by verifyPlatformScheduler
//   resources               runtime assets incl. resources/stt/sttWorker.cjs
//   build                   app + tray icons (tray reads build/trayDark.png at runtime)
//   node_modules/sherpa-*   STT native addon + platform libs; NOT in the import graph (the
//                           sidecar spawns an external node), so they must be included
//                           explicitly. materializeResource() extracts them VFS→disk at runtime
//                           (dlopen can't read the VFS). Only the platform dirs present on disk
//                           are included — fetch-sherpa-prebuilds.mjs populates the right one
//                           per dist:<os> target.
//
// PACKAGED-MODE NOTE: the non-omp Claude backend requires a system `claude` CLI on PATH — the
// same documented prerequisite as the Electron app (see README); the SDK's VFS-bundled fallback
// binary is not execve-able.
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform, arch } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const denoBin = process.env.DENO_BIN ?? "deno";

// platform alias → deno target triple(s)
const TARGETS = {
  linux: ["x86_64-unknown-linux-gnu"],
  "linux-arm64": ["aarch64-unknown-linux-gnu"],
  mac: ["x86_64-apple-darwin", "aarch64-apple-darwin"],
  win: ["x86_64-pc-windows-msvc"],
};

function hostAlias() {
  if (platform() === "darwin") return "mac";
  if (platform() === "win32") return "win";
  return arch() === "arm64" ? "linux-arm64" : "linux";
}

const arg = process.argv[2] ?? hostAlias();
let targets;
if (arg === "all") {
  targets = null; // use --all-targets
} else if (TARGETS[arg]) {
  targets = TARGETS[arg];
} else if (arg.includes("-")) {
  targets = [arg]; // explicit triple
} else {
  console.error(`unknown target '${arg}'. Use: ${Object.keys(TARGETS).join(", ")}, all, or a triple`);
  process.exit(2);
}

function step(label, cmd, args) {
  console.log(`\n[dist] ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`[dist] ${label} FAILED (status=${r.status})`);
    process.exit(r.status ?? 1);
  }
}

// 1. Build the renderer (out/renderer).
step("renderer build", process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build"]);

// 2. Rebuild the headless taskRunner bundle (scheduler dependency) from current source —
//    unconditional (one esbuild pass) so an out-of-date bundle is never shipped.
step("headless build", "npm", ["run", "build:headless"]);

// 3. Compile the desktop app per target. The sherpa packages ride the VFS and are extracted to
//    disk at runtime by materializeResource() (external node processes can't read the VFS).
const sherpaDirs = readdirSync(resolve(root, "node_modules"))
  .filter((n) => n === "sherpa-onnx-node" || /^sherpa-onnx-(linux|darwin|win)-/.test(n))
  .map((n) => `node_modules/${n}`)
  .filter((d) => existsSync(resolve(root, d)));
const includes = ["out/renderer", "out/headless", "resources", "build", ...sherpaDirs].flatMap((d) => ["--include", d]);
// deno desktop auto-embeds EVERY nested node_modules tree under cwd (verified via the build
// manifest: présentation/, release/*/resources/app/, dist-headless/ node_modules all shipped —
// ~475MB unique junk). Those are public npm bytes (no secrets), but they bloat every artifact.
// They ARE "included files", so --exclude applies to them (unlike top-level junk dirs, which are
// never embedded in the first place). Root node_modules (and trees inside it) must stay.
// Portable JS walk (no `find`: the dist:win CI leg runs on windows-latest).
function nestedNodeModules(dir, depth, rel) {
  if (depth > 8) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const childRel = rel.length > 0 ? `${rel}/${entry.name}` : entry.name;
    if (depth === 0 && (entry.name === "node_modules" || entry.name === "dist-deno" || entry.name.startsWith("."))) continue;
    if (entry.name === "node_modules") {
      out.push(childRel); // topmost match — do not descend
      continue;
    }
    out.push(...nestedNodeModules(resolve(dir, entry.name), depth + 1, childRel));
  }
  return out;
}
const excludes = nestedNodeModules(root, 0, "").flatMap((d) => ["--exclude", d]);
const baseArgs = ["desktop", "--backend", "cef", "-A", "--no-check", ...includes, ...excludes];

if (targets === null) {
  step("desktop build (all targets)", denoBin, [...baseArgs, "--all-targets", "src/desktop/main.ts"]);
} else {
  for (const t of targets) {
    step(`desktop build (${t})`, denoBin, [...baseArgs, "--target", t, "src/desktop/main.ts"]);
  }
}
console.log("\n[dist] done → dist-deno/");
