// Node STT sidecar manager for the `deno desktop` shell.
//
// `sherpa-onnx-node` is an N-API native addon that CANNOT load in-process under `deno desktop`
// (verified in Phase 0: `undefined symbol: napi_create_error`). So sherpa transcription runs in
// a spawned `node` child process (resources/stt/sttWorker.cjs) — a plain Node runtime CAN load
// the addon (smoke-tested: `require('sherpa-onnx-node')` → OfflineRecognizer). We talk to the
// child over line-delimited JSON on stdio.
//
// The sidecar is spawned lazily on the first transcribe() and reused across calls (the worker
// caches the expensive OfflineRecognizer). If it crashes or a request times out, it is torn
// down and re-spawned on the next call.
//
// SPAWN CONTRACT
//   binary : $AGENT_NODE_PATH or `node` (resolved via PATH)
//   args   : [ resourcePath("resources/stt/sttWorker.cjs") ]
//   env    : the platform library dir is prepended to the OS shared-library search path so the
//            addon's sibling libs (libsherpa-onnx-c-api, libonnxruntime, …) load:
//              linux   -> LD_LIBRARY_PATH   = <repo>/node_modules/sherpa-onnx-linux-<arch> : $LD_LIBRARY_PATH
//              macOS   -> DYLD_LIBRARY_PATH = <repo>/node_modules/sherpa-onnx-darwin-<arch> : $DYLD_LIBRARY_PATH
//              windows -> PATH             = <repo>\node_modules\sherpa-onnx-win-x64 ; %PATH%
//            (Deno.Command merges these over the inherited parent env.)
//   cwd    : inherited — `require('sherpa-onnx-node')` resolves from the worker file's own
//            directory (node_modules at the repo root), independent of cwd.
//   NOTE (packaged): a `node` child reads the REAL filesystem, not deno's compiled VFS. The
//   worker script + node_modules/sherpa-onnx-* are therefore materialized (VFS → disk copy under
//   userData, see paths.materializeResource) before the spawn; in dev the repo paths are used.
import { join } from "node:path";
import { materializeResource } from "../paths";
import { createLogger } from "../../core/utils/logger";

const log = createLogger("desktop/sttSidecar");

// First call pays the model-load cost (encoders can be hundreds of MB); keep the ceiling generous.
const TIMEOUT_MS = 120_000;

export interface SttOptions {
  /** OfflineRecognizer config (from core buildRecognizerConfig) — self-contained, absolute paths. */
  config: Record<string, unknown>;
  /** Recognizer cache key (model path + hotwords signature) so the worker reuses the loaded model. */
  cacheKey: string;
}

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  cancel: () => void;
}

interface Sidecar {
  child: Deno.ChildProcess;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  alive: boolean;
}

let sidecar: Sidecar | null = null;
let nextId = 0;
const pending = new Map<number, PendingRequest>();
const encoder = new TextEncoder();

function sherpaLibEnv(): Record<string, string> {
  const osTag = Deno.build.os === "darwin" ? "darwin" : Deno.build.os === "windows" ? "win" : "linux";
  const archTag = Deno.build.arch === "aarch64" ? "arm64" : "x64";
  const libDir = materializeResource(join("node_modules", `sherpa-onnx-${osTag}-${archTag}`));
  const varName = Deno.build.os === "darwin" ? "DYLD_LIBRARY_PATH" : Deno.build.os === "windows" ? "PATH" : "LD_LIBRARY_PATH";
  const sep = Deno.build.os === "windows" ? ";" : ":";
  const existing = Deno.env.get(varName) ?? "";
  return { [varName]: existing.length > 0 ? `${libDir}${sep}${existing}` : libDir };
}

function failAllPending(err: Error): void {
  for (const [, p] of pending) {
    p.cancel();
    p.reject(err);
  }
  pending.clear();
}

function handleResponse(line: string): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    log.warn("sidecar sent an unparseable line", { line: trimmed.slice(0, 200) });
    return;
  }
  if (typeof msg !== "object" || msg === null) return;
  const rec = msg as Record<string, unknown>;
  if (typeof rec.id !== "number") return;
  const p = pending.get(rec.id);
  if (!p) return;
  pending.delete(rec.id);
  p.cancel();
  if (rec.ok === true && typeof rec.text === "string") {
    p.resolve(rec.text);
  } else {
    p.reject(new Error(typeof rec.error === "string" ? rec.error : "STT sidecar returned no text"));
  }
}

async function readResponses(sc: Sidecar): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of sc.child.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        handleResponse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
    }
  } catch (err) {
    log.warn("sidecar stdout read error", { err: err instanceof Error ? err.message : String(err) });
  }
}

async function logStderr(sc: Sidecar): Promise<void> {
  const decoder = new TextDecoder();
  try {
    for await (const chunk of sc.child.stderr) {
      const text = decoder.decode(chunk).trim();
      if (text.length > 0) log.warn("sidecar stderr", { text });
    }
  } catch {
    // stream closes on process exit — nothing to do.
  }
}

async function watchExit(sc: Sidecar): Promise<void> {
  let code = -1;
  let signal: Deno.Signal | null = null;
  try {
    const status = await sc.child.status;
    code = status.code;
    signal = status.signal;
  } catch (err) {
    log.warn("sidecar status error", { err: err instanceof Error ? err.message : String(err) });
  }
  sc.alive = false;
  if (sidecar === sc) sidecar = null;
  log.info("sidecar exited", { code, signal });
  failAllPending(new Error(`STT sidecar exited (code ${code}${signal ? `, signal ${signal}` : ""})`));
}

function killSidecar(sc: Sidecar): void {
  try {
    sc.child.kill("SIGKILL");
  } catch {
    // already gone
  }
}

function ensureSidecar(): Sidecar {
  if (sidecar && sidecar.alive) return sidecar;
  // Materialize the worker + both sherpa packages so the external node process can read them
  // (require() walks up from the worker's materialized location to <mat>/node_modules).
  const workerPath = materializeResource(join("resources", "stt", "sttWorker.cjs"));
  materializeResource(join("node_modules", "sherpa-onnx-node"));
  const nodePath = Deno.env.get("AGENT_NODE_PATH") ?? "node";
  const command = new Deno.Command(nodePath, {
    args: [workerPath],
    env: sherpaLibEnv(),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const sc: Sidecar = { child, writer: child.stdin.getWriter(), alive: true };
  sidecar = sc;
  log.info("spawned STT sidecar", { node: nodePath, worker: workerPath });
  void readResponses(sc);
  void logStderr(sc);
  void watchExit(sc);
  return sc;
}

/**
 * Transcribe a WAV buffer through the Node sherpa sidecar. Lazily spawns (and reuses) the worker.
 * The audio is handed off as a temp WAV file (robust for large clips vs. a giant JSON line); the
 * worker parses + decodes it and returns the recognized text. Resolves to the trimmed transcript
 * (possibly ""), or rejects with the worker's error (missing model, bad config, load failure, …).
 */
export async function transcribe(audio: Uint8Array, opts: SttOptions): Promise<string> {
  const tmpPath = await Deno.makeTempFile({ prefix: "agent-sherpa-", suffix: ".wav" });
  try {
    await Deno.writeFile(tmpPath, audio);
    const sc = ensureSidecar();
    const id = ++nextId;
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        reject(new Error(`STT sidecar timed out after ${TIMEOUT_MS / 1000}s`));
        // A wedged worker would stall every later request behind it — recycle to recover.
        killSidecar(sc);
      }
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, cancel: () => clearTimeout(timer) });
    const req = JSON.stringify({ id, cacheKey: opts.cacheKey, config: opts.config, audioPath: tmpPath }) + "\n";
    try {
      await sc.writer.write(encoder.encode(req));
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      throw new Error("failed to send request to STT sidecar: " + (err instanceof Error ? err.message : String(err)));
    }
    return await promise;
  } finally {
    await Deno.remove(tmpPath).catch(() => {});
  }
}

/** Tear down the sidecar (rejecting any in-flight requests). Call on app shutdown. */
export function shutdownSttSidecar(): void {
  const sc = sidecar;
  if (!sc) return;
  sidecar = null;
  failAllPending(new Error("STT sidecar shutting down"));
  killSidecar(sc);
}
