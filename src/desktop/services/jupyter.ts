// Ported from src/main/services/jupyter.ts. Registers `jupyter:*` on the dispatch registry
// (origin 'local'). Electron swaps: app.isPackaged/process.resourcesPath/app.getAppPath →
// resourcePath('resources/jupyter/bridge.py'); getMainWindow + webContents.send → broadcast()
// (the uiBridge fans it to the WS renderer). Kernels are still spawned as node child processes.
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";
import type { HandleRegistrar } from "../../core/dispatch";
import { findBinaryInPath } from "../../core/utils/env";
import { broadcast } from "../../core/utils/broadcast";
import { validateString } from "../../core/utils/validate";
import { createLogger } from "../../core/utils/logger";
import { resourcePath } from "../paths";
import { sanitizeError } from "../utils/errors";

const log = createLogger("jupyter");

// ─── Types ────────────────────────────────────────────

interface KernelProcess {
  proc: ChildProcess;
  status: "starting" | "idle" | "busy";
  language: string;
  filePath: string;
  pendingRequests: Map<string, { resolve: () => void }>;
  requestCounter: number;
}

// ─── State ────────────────────────────────────────────

const kernels = new Map<string, KernelProcess>();

// ─── Helpers ──────────────────────────────────────────

function nextRequestId(kernel: KernelProcess): string {
  kernel.requestCounter++;
  return `req_${kernel.requestCounter}`;
}

// ─── Kernel lifecycle ─────────────────────────────────

function startKernel(filePath: string, kernelName?: string): { status: string } {
  if (kernels.has(filePath)) {
    const existing = kernels.get(filePath)!;
    return { status: existing.status };
  }

  const pythonBin = findBinaryInPath("python3") || findBinaryInPath("python");
  if (!pythonBin) {
    throw new Error("Python not found in PATH");
  }

  const scriptPath = resourcePath("resources/jupyter/bridge.py");
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (kernelName) {
    env.JUPYTER_KERNEL_NAME = kernelName;
  }

  const proc = spawn(pythonBin, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });

  const kernel: KernelProcess = {
    proc,
    status: "starting",
    language: "python",
    filePath,
    pendingRequests: new Map(),
    requestCounter: 0,
  };

  kernels.set(filePath, kernel);

  // Parse stdout JSON lines
  const rl = readline.createInterface({ input: proc.stdout! });
  rl.on("line", (line) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    const msgType = msg.type as string;

    // Handle ready message
    if (msgType === "ready") {
      kernel.status = "idle";
      kernel.language = (msg.language as string) || "python";
      broadcast("jupyter:output", {
        filePath,
        id: null,
        type: "ready",
        language: kernel.language,
        state: "idle",
      });
      return;
    }

    // Track kernel status
    if (msgType === "status") {
      const state = msg.state as string;
      if (state === "idle" || state === "busy") {
        kernel.status = state as "idle" | "busy";
      }
    }

    // Forward to renderer with filePath tag
    broadcast("jupyter:output", { ...msg, filePath });
  });

  // Log stderr (not forwarded to renderer — it's kernel debug info)
  const stderrRl = readline.createInterface({ input: proc.stderr! });
  stderrRl.on("line", (line) => {
    log.debug("kernel stderr", { file: path.basename(filePath), line });
  });

  proc.on("exit", (code) => {
    log.info("kernel exited", { filePath, code });
    kernels.delete(filePath);
    broadcast("jupyter:output", {
      filePath,
      id: null,
      type: "status",
      state: "dead",
    });
  });

  proc.on("error", (err) => {
    log.error("kernel spawn error", err, { filePath });
    kernels.delete(filePath);
    broadcast("jupyter:output", {
      filePath,
      id: null,
      type: "error",
      ename: "SpawnError",
      evalue: sanitizeError(err),
      traceback: [],
    });
  });

  return { status: "starting" };
}

function executeCell(filePath: string, code: string): string {
  const kernel = kernels.get(filePath);
  if (!kernel) throw new Error("No kernel running for this notebook");
  if (!kernel.proc.stdin?.writable) throw new Error("Kernel stdin not writable");

  const id = nextRequestId(kernel);
  const request = JSON.stringify({ id, action: "execute", code });
  kernel.proc.stdin.write(request + "\n");
  return id;
}

function interruptKernel(filePath: string): void {
  const kernel = kernels.get(filePath);
  if (!kernel) throw new Error("No kernel running for this notebook");
  if (!kernel.proc.stdin?.writable) return;

  const id = nextRequestId(kernel);
  kernel.proc.stdin.write(JSON.stringify({ id, action: "interrupt" }) + "\n");
}

function restartKernel(filePath: string): void {
  const kernel = kernels.get(filePath);
  if (!kernel) throw new Error("No kernel running for this notebook");
  if (!kernel.proc.stdin?.writable) return;

  kernel.status = "starting";
  const id = nextRequestId(kernel);
  kernel.proc.stdin.write(JSON.stringify({ id, action: "restart" }) + "\n");
}

function shutdownKernel(filePath: string): void {
  const kernel = kernels.get(filePath);
  if (!kernel) return;

  if (kernel.proc.stdin?.writable) {
    kernel.proc.stdin.write(JSON.stringify({ action: "shutdown" }) + "\n");
  }

  // Give it 3s to exit gracefully, then force kill
  const timeout = setTimeout(() => {
    if (!kernel.proc.killed) {
      kernel.proc.kill("SIGKILL");
    }
  }, 3000);

  kernel.proc.on("exit", () => clearTimeout(timeout));
  kernels.delete(filePath);
}

function getStatus(filePath: string): string | null {
  const kernel = kernels.get(filePath);
  return kernel ? kernel.status : null;
}

async function detectJupyter(): Promise<{ found: boolean; pythonPath: string | null; error?: string }> {
  const pythonBin = findBinaryInPath("python3") || findBinaryInPath("python");
  if (!pythonBin) {
    return { found: false, pythonPath: null, error: "Python not found in PATH" };
  }

  const { promise, resolve } = Promise.withResolvers<{ found: boolean; pythonPath: string | null; error?: string }>();
  const proc = spawn(pythonBin, ["-c", 'import jupyter_client; import ipykernel; print("ok")'], {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
  });

  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (d) => {
    stdout += d.toString();
  });
  proc.stderr?.on("data", (d) => {
    stderr += d.toString();
  });
  proc.on("close", (code) => {
    if (code === 0 && stdout.trim() === "ok") {
      resolve({ found: true, pythonPath: pythonBin });
    } else {
      // Determine which package is missing
      let error = "jupyter_client and ipykernel required";
      if (stderr.includes("ipykernel")) {
        error = "ipykernel not installed. Run: pip install ipykernel";
      } else if (stderr.includes("jupyter_client")) {
        error = "jupyter not installed. Run: pip install jupyter ipykernel";
      }
      resolve({ found: false, pythonPath: pythonBin, error });
    }
  });
  proc.on("error", () => {
    resolve({ found: false, pythonPath: pythonBin, error: "Failed to run Python" });
  });
  return promise;
}

// ─── Cleanup ──────────────────────────────────────────

export function shutdownAllKernels(): void {
  for (const [filePath, kernel] of kernels) {
    // Send SIGTERM immediately as safety net — if the graceful shutdown
    // message (via stdin) doesn't reach the kernel, this ensures it dies
    try {
      kernel.proc.kill("SIGTERM");
    } catch { /* already dead */ }
    shutdownKernel(filePath);
  }
}

// ─── Handler registration ─────────────────────────────

export function registerHandlers(dispatch: HandleRegistrar, _db: unknown): void {
  dispatch.handle("jupyter:startKernel", (_e, filePath: unknown, kernelName?: unknown) => {
    const fp = validateString(filePath, "filePath");
    const kn = kernelName != null ? validateString(kernelName, "kernelName", 100) : undefined;
    return startKernel(fp, kn);
  });

  dispatch.handle("jupyter:executeCell", (_e, filePath: unknown, code: unknown) => {
    const fp = validateString(filePath, "filePath");
    const c = validateString(code, "code", 10_000_000);
    return executeCell(fp, c);
  });

  dispatch.handle("jupyter:interruptKernel", (_e, filePath: unknown) => {
    interruptKernel(validateString(filePath, "filePath"));
  });

  dispatch.handle("jupyter:restartKernel", (_e, filePath: unknown) => {
    restartKernel(validateString(filePath, "filePath"));
  });

  dispatch.handle("jupyter:shutdownKernel", (_e, filePath: unknown) => {
    shutdownKernel(validateString(filePath, "filePath"));
  });

  dispatch.handle("jupyter:getStatus", (_e, filePath: unknown) => {
    return getStatus(validateString(filePath, "filePath"));
  });

  dispatch.handle("jupyter:detectJupyter", () => {
    return detectJupyter();
  });
}
