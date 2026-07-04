/**
 * Custom wake-word training — Category C sidecar orchestration, ported from
 * src/main/services/hotwordTrainer.ts. Registers `hotwordTrain:*` on the dispatch registry
 * (origin 'local'). Electron swaps: app.getPath('userData') → userDataDir(); the packaged/dev
 * script path → resourcePath('resources/hotword/train_wakeword.py'); getMainWindow + webContents.send
 * → broadcast() (the uiBridge fans it to the WS renderer).
 *
 * openWakeWord training is NOT inference: it needs PyTorch + piper-sample-generator to synthesize
 * speech samples, augment them, train a small DNN, and export a ~200KB ONNX. None of that runs in
 * onnxruntime-web, so we spawn a native Python process and stream its stdout as progress. The Python
 * pipeline (resources/hotword/train_wakeword.py) and the one-time venv provisioning are pure process
 * management around a real machine.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import type Database from "better-sqlite3";
import type { HandleRegistrar } from "../../core/dispatch";
import { findBinaryInPath } from "../../core/utils/env";
import { validateString } from "../../core/utils/validate";
import { getSetting } from "../../core/utils/db";
import { createLogger } from "../../core/utils/logger";
import { broadcast } from "../../core/utils/broadcast";
import { resourcePath, userDataDir } from "../paths";
import { sanitizeError } from "../utils/errors";

const log = createLogger("hotwordTrainer");

const EVENT = "hotwordTrain:event";

type TrainEvent =
  | { kind: "log"; message: string }
  | { kind: "progress"; pct: number; message: string }
  | { kind: "done"; slug: string; modelPath: string }
  | { kind: "error"; message: string }
  | { kind: "setup-done" };

let active: ChildProcess | null = null;
let activePhrase: string | null = null;

// All training events flow through the single EVENT channel — this binds that contract for the 15+
// call sites and swaps webContents.send for broadcast (the WS renderer receives it via the uiBridge).
function emit(ev: TrainEvent): void {
  broadcast(EVENT, ev);
}

function modelsDir(): string {
  return path.join(userDataDir(), "hotword-models");
}

function venvDir(): string {
  return path.join(userDataDir(), "hotword-train", "venv");
}

function venvPython(): string {
  // POSIX layout; the project targets Linux for training (Piper requirement).
  return path.join(venvDir(), "bin", "python");
}

/** Resolve the training python: explicit override → managed venv → system python3. */
async function resolvePython(db: Database.Database): Promise<string | null> {
  const override = getSetting(db, "hotwordTrain_pythonPath");
  if (override) return override;
  try {
    await fs.access(venvPython());
    return venvPython();
  } catch {
    return findBinaryInPath("python3") || findBinaryInPath("python");
  }
}

function slugify(phrase: string): string {
  return phrase.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "wakeword";
}

/** Parse "PROGRESS <0..1> <message>" lines emitted by the python script; else forward as a log. */
function handleLine(line: string): void {
  const m = line.match(/^PROGRESS\s+([\d.]+)\s+(.*)$/);
  if (m) {
    emit({ kind: "progress", pct: Math.max(0, Math.min(1, Number(m[1]))), message: m[2] });
  } else if (line.trim()) {
    emit({ kind: "log", message: line });
  }
}

function streamProcess(proc: ChildProcess): void {
  proc.stdout?.on("data", (b: Buffer) => b.toString().split("\n").forEach(handleLine));
  proc.stderr?.on("data", (b: Buffer) => b.toString().split("\n").forEach((l) => l.trim() && emit({ kind: "log", message: l })));
}

async function listModels(): Promise<{ slug: string; path: string }[]> {
  const dir = modelsDir();
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".onnx")).map((f) => ({ slug: f.replace(/\.onnx$/, ""), path: path.join(dir, f) }));
  } catch {
    return [];
  }
}

async function startTraining(db: Database.Database, phrase: string): Promise<{ started: boolean }> {
  validateString(phrase, "phrase", 100);
  if (active) throw new Error("A training run is already in progress");

  const python = await resolvePython(db);
  if (!python) throw new Error("Python not found. Install the training tools or set a Python path in Settings.");

  const out = modelsDir();
  await fs.mkdir(out, { recursive: true });
  const slug = slugify(phrase);

  const scriptPath = resourcePath("resources/hotword/train_wakeword.py");
  const proc = spawn(python, [scriptPath, "--phrase", phrase, "--slug", slug, "--out", out], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...(process.env as Record<string, string>) },
  });
  active = proc;
  activePhrase = phrase;
  streamProcess(proc);

  proc.on("error", (err) => {
    active = null;
    activePhrase = null;
    emit({ kind: "error", message: sanitizeError(err) });
  });
  proc.on("close", (code) => {
    active = null;
    activePhrase = null;
    if (code === 0) {
      emit({ kind: "done", slug, modelPath: path.join(out, `${slug}.onnx`) });
    } else {
      emit({ kind: "error", message: `Training exited with code ${code}` });
    }
  });

  log.info("hotword training started", { slug });
  return { started: true };
}

/** Create the venv and pip-install the training toolchain (one-time, hundreds of MB). */
async function setupEnv(): Promise<{ started: boolean }> {
  if (active) throw new Error("A training/setup run is already in progress");
  const base = findBinaryInPath("python3") || findBinaryInPath("python");
  if (!base) throw new Error("Python 3 not found in PATH. Install Python 3 first.");

  await fs.mkdir(path.dirname(venvDir()), { recursive: true });
  emit({ kind: "progress", pct: 0.05, message: "Creating virtual environment…" });

  const mkvenv = spawn(base, ["-m", "venv", venvDir()], { stdio: ["ignore", "pipe", "pipe"] });
  active = mkvenv;
  streamProcess(mkvenv);
  mkvenv.on("error", (err) => {
    active = null;
    emit({ kind: "error", message: sanitizeError(err) });
  });
  mkvenv.on("close", (code) => {
    if (code !== 0) {
      active = null;
      emit({ kind: "error", message: `venv creation failed (code ${code})` });
      return;
    }
    emit({ kind: "progress", pct: 0.2, message: "Installing torch + openwakeword + piper-sample-generator (large download)…" });
    const pip = spawn(venvPython(), ["-m", "pip", "install", "--upgrade", "pip", "openwakeword", "torch", "piper-tts", "piper-sample-generator"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    active = pip;
    streamProcess(pip);
    pip.on("error", (err) => {
      active = null;
      emit({ kind: "error", message: sanitizeError(err) });
    });
    pip.on("close", (c) => {
      active = null;
      if (c === 0) emit({ kind: "setup-done" });
      else emit({ kind: "error", message: `Dependency install failed (code ${c})` });
    });
  });
  return { started: true };
}

function cancel(): { cancelled: boolean } {
  if (active) {
    active.kill();
    active = null;
    activePhrase = null;
    return { cancelled: true };
  }
  return { cancelled: false };
}

export function registerHandlers(dispatch: HandleRegistrar, db: Database.Database): void {
  dispatch.handle("hotwordTrain:listModels", () => listModels());
  dispatch.handle("hotwordTrain:start", (_e, phrase: unknown) => startTraining(db, String(phrase ?? "")));
  dispatch.handle("hotwordTrain:setup", () => setupEnv());
  dispatch.handle("hotwordTrain:cancel", () => cancel());
  dispatch.handle("hotwordTrain:status", () => ({ running: active !== null, phrase: activePhrase }));
}
