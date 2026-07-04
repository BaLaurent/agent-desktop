#!/usr/bin/env node
// Dev loop for the deno desktop shell. Runs two long-lived children:
//   1. `vite build --watch` — rebuilds out/renderer on renderer source change (press F5 in the
//      window to reload the served UI).
//   2. `deno desktop --hmr` — the Deno backend; hot-reloads src/desktop + src/core on change.
// Requires deno >= 2.9 on PATH (the `desktop` subcommand); override with DENO_BIN.
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const denoBin = process.env.DENO_BIN ?? "deno";

// sherpa-onnx native libs live in a per-arch npm package; the STT sidecar dlopen()s them.
const sherpaLibDir =
  platform() === "linux" ? resolve(root, "node_modules/sherpa-onnx-linux-x64") : null;
const ldPath = sherpaLibDir
  ? `${sherpaLibDir}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ""}`
  : process.env.LD_LIBRARY_PATH;

const children = [];
function run(label, cmd, args, extraEnv) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  child.on("exit", (code, signal) => {
    console.log(`[dev-desktop] ${label} exited (code=${code}, signal=${signal}); shutting down`);
    shutdown();
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Renderer watcher → out/renderer.
run("vite", process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build", "--watch"]);

// Deno desktop backend with HMR.
run(
  "deno-desktop",
  denoBin,
  ["desktop", "--hmr", "--backend", "cef", "-A", "--no-check", "src/desktop/main.ts"],
  { AGENT_DEV: "1", ...(ldPath ? { LD_LIBRARY_PATH: ldPath } : {}) },
);
