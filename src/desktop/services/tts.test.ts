// Ported from src/main/services/tts.test.ts. The Electron test drove speak/speakResponse/
// speakMessage/validateConfig/detectPlayers — but in the deno-desktop split those are CORE functions
// (src/core/handlers/tts, which owns their tests) that the ported tts.ts merely RE-EXPORTS. What the
// desktop tts.ts uniquely contributes is the Electron→broadcast rewiring: it replaces
// webContents.send with two core registrations —
//   1. setSpeakingStateListener → broadcast('tts:stateChange', {speaking, messageId})
//   2. setWebAudioSink → broadcast('tts:audio', …) gated on hasWebClients()
// and an intentionally-empty registerHandlers (tts:* channels are registered by core dispatch).
//
// This test exercises the observable desktop-specific wiring on a real seam: importing tts.ts
// registers the listener, and calling the re-exported stop() runs core's notifySpeakingState(false)
// (a no-op internally when nothing is playing — no subprocess), which must fan out through the
// desktop listener as a broadcast('tts:stateChange'). The web-audio sink's send() is only invoked by
// core's speak() pipeline (subprocess-driven, core-tested) so it is not triggerable in isolation;
// that path is left to core's tests.
import { assert, assertEquals } from "jsr:@std/assert";
import type { HandleRegistrar } from "../../core/dispatch.ts";
import { addBroadcastHandler } from "../../core/utils/broadcast.ts";
import { registerHandlers, stop } from "./tts.ts";

Deno.test("importing tts.ts wires the speaking-state listener → broadcast('tts:stateChange')", () => {
  const events: Array<{ channel: string; args: unknown[] }> = [];
  const unsub = addBroadcastHandler((channel, ...args) => events.push({ channel, args }));
  try {
    // Idle stop() → core notifySpeakingState(false) → desktop listener → broadcast.
    stop();
    const stateEvents = events.filter((e) => e.channel === "tts:stateChange");
    assert(stateEvents.length >= 1);
    assertEquals(stateEvents.at(-1)!.args[0], { speaking: false, messageId: null });
  } finally {
    unsub();
  }
});

Deno.test("registerHandlers registers no channels (tts:* is core-owned)", () => {
  const registered: string[] = [];
  const dispatch: HandleRegistrar = { handle: (channel) => registered.push(channel) };
  registerHandlers(dispatch, undefined);
  assertEquals(registered, []);
});
