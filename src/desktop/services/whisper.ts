// STT Cat C service for the `deno desktop` shell. Ported from src/main/services/whisper.ts.
//
// INVESTIGATION (the assignment asked whether STT needs a sidecar):
//   • whisper:*  — the `whisper` engine shells out to the whisper.cpp CLI as a SUBPROCESS
//     (core/services/whisper.ts spawns `whisper-cli`). It is NOT a native addon, uses no Electron
//     API, and runs UNCHANGED under deno. whisper:transcribe / whisper:validateConfig and the
//     voice:duck / voice:restore audio-ducking channels are all registered by core/handlers
//     (whisper.ts) inside engine.init(), so — per the established Cat C convention (see files.ts /
//     streaming.ts: "register only what core cannot serve") — this service does NOT re-register them.
//   • sherpa:*   — the `sherpa` engine uses the `sherpa-onnx-node` N-API addon. It loads fine in a
//     plain `node` process but FAILS in-process under deno desktop (`napi_create_error`). Only
//     sherpa:transcribe actually touches the addon; sherpa:validateConfig / :downloadModel /
//     :listInstalledModels are pure JS (readdir / HTTP) and are served correctly by core.
//
// So the ONE STT channel core cannot serve under deno is `sherpa:transcribe`. We OVERRIDE it here
// (DispatchRegistry.handle is last-writer-wins; Cat C services register after engine.init()): the
// DB-dependent prep (model detection + hotwords + recognizer config) runs on the deno side, and
// the addon runs in the Node sidecar (./sttSidecar). Everything else stays on the core handlers.
import type { HandleRegistrar } from "../../core/dispatch";
import type Database from "better-sqlite3";
import { promises as fsp } from "node:fs";
import { getSetting } from "../../core/utils/db";
import { buildRecognizerConfig, detectArchitecture, recognizerCacheKey, resolveHotwords } from "../../core/services/sherpaStt";
import { transcribe as sidecarTranscribe } from "./sttSidecar";

// Mirrors core/services/sherpaStt.ts::MAX_BUFFER_SIZE — reject oversized clips before the handoff.
const MAX_BUFFER_SIZE = 50 * 1024 * 1024;

// The dispatch layer hands the live DB as `unknown` (concretely a sql.js adapter, structurally
// compatible with the better-sqlite3 surface getSetting/resolveHotwords read). Mirror files.ts.
function isSqliteHandle(db: unknown): db is Database.Database {
  return typeof db === "object" && db !== null && "prepare" in db && typeof db.prepare === "function";
}

// Audio arrives as a Uint8Array (the WS bridge decodes {__type:'binary'} → Uint8Array; see
// uiBridge.ts::decodeArg). Accept a plain number[] defensively for direct/local callers.
function toAudioBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw) && raw.every((n): n is number => typeof n === "number")) return Uint8Array.from(raw);
  throw new Error("sherpa:transcribe expects the audio as bytes (Uint8Array)");
}

export function registerHandlers(dispatch: HandleRegistrar, db: unknown): void {
  if (!isSqliteHandle(db)) throw new Error("whisper STT service: expected a sqlite database handle");
  // Capture the narrowed handle as a const so the type survives into the async closure.
  const sql = db;

  // OVERRIDE core/handlers/sherpa.ts::sherpa:transcribe — the addon cannot run in-process under
  // deno desktop. Build the recognizer config here (needs the DB: model path + custom-word
  // lexicon → hotwords) and hand the transcription to the Node sidecar.
  dispatch.handle("sherpa:transcribe", async (_event, wavBuffer: unknown) => {
    const audio = toAudioBytes(wavBuffer);
    if (audio.length === 0) throw new Error("Empty audio buffer");
    if (audio.length > MAX_BUFFER_SIZE) {
      throw new Error(`Audio buffer too large (max ${MAX_BUFFER_SIZE / 1024 / 1024}MB)`);
    }
    const modelPath = getSetting(sql, "sherpa_modelPath");
    if (!modelPath) throw new Error("Sherpa model path not configured. Go to Settings > Voice Input.");
    const files = await fsp.readdir(modelPath);
    const detection = detectArchitecture(files);
    const hot = await resolveHotwords(sql, modelPath, files, detection);
    const config = buildRecognizerConfig(modelPath, detection, hot);
    const cacheKey = recognizerCacheKey(modelPath, hot);
    const text = await sidecarTranscribe(audio, { config, cacheKey });
    return { text };
  });
}
