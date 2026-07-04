// Ported from src/main/services/whisper.test.ts. The Electron test imported transcribe/
// validateConfig/getSetting/buildAdvancedArgs FROM ./whisper and mocked child_process + fs to drive
// the whisper.cpp CLI. In the deno-desktop split those functions moved to CORE (core/handlers +
// core/services/whisper, which owns their tests). The ported whisper.ts exports ONLY registerHandlers
// and its sole job is to OVERRIDE sherpa:transcribe — routing the sherpa-onnx addon to the Node
// sidecar because the N-API addon can't load in-process under deno desktop.
//
// So this test targets the desktop-specific contribution: the db-handle guard and the sherpa:transcribe
// validation gate, all of which run BEFORE the sidecar handoff (no addon, no subprocess). The actual
// transcription (sidecarTranscribe → Node sidecar + sherpa addon) and the model-present path are E2E
// concerns and are not unit-tested.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import type { HandleRegistrar } from "../../core/dispatch.ts";
import { createTestDb } from "../../core/__tests__/db-helper.ts";
import { registerHandlers } from "./whisper.ts";

const MAX_BUFFER_SIZE = 50 * 1024 * 1024;

interface Handler {
  (event: unknown, ...args: unknown[]): unknown;
}

function captureHandlers(db: unknown): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const dispatch: HandleRegistrar = { handle: (channel, listener) => handlers.set(channel, listener) };
  registerHandlers(dispatch, db);
  return handlers;
}

Deno.test("registerHandlers rejects a non-sqlite db handle", () => {
  const dispatch: HandleRegistrar = { handle: () => {} };
  // A plain object has no `prepare` → the isSqliteHandle guard throws.
  let threw = false;
  try {
    registerHandlers(dispatch, {});
  } catch (e) {
    threw = true;
    assert(e instanceof Error && e.message.includes("sqlite database handle"));
  }
  assertEquals(threw, true);
});

Deno.test("registerHandlers registers the sherpa:transcribe override", async () => {
  const db = await createTestDb();
  try {
    const handlers = captureHandlers(db);
    assert(handlers.has("sherpa:transcribe"));
  } finally {
    db.close();
  }
});

Deno.test("sherpa:transcribe validation gate", async (t) => {
  const db = await createTestDb();
  const handlers = captureHandlers(db);
  const transcribe = handlers.get("sherpa:transcribe")!;
  try {
    await t.step("rejects a non-bytes audio argument", async () => {
      await assertRejects(() => Promise.resolve(transcribe(null, "not-bytes")), Error, "expects the audio as bytes");
    });

    await t.step("rejects an empty audio buffer", async () => {
      await assertRejects(() => Promise.resolve(transcribe(null, new Uint8Array(0))), Error, "Empty audio buffer");
    });

    await t.step("rejects an oversized audio buffer before touching the model/sidecar", async () => {
      await assertRejects(() => Promise.resolve(transcribe(null, new Uint8Array(MAX_BUFFER_SIZE + 1))), Error, "too large");
    });

    await t.step("rejects when the sherpa model path is not configured", async () => {
      // Fresh DB has no sherpa_modelPath → the handler throws before any sidecar call.
      await assertRejects(() => Promise.resolve(transcribe(null, new Uint8Array([1, 2, 3, 4]))), Error, "model path not configured");
    });
  } finally {
    db.close();
  }
});
