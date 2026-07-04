// Ported from src/main/services/tts.ts. The tts:* channels themselves are owned by core dispatch
// (registerTtsHandlers), so this module's job is the two side-effect wirings the Electron adapter
// did — swapping webContents.send for broadcast:
//   1. speaking-state notifications → broadcast('tts:stateChange', …)
//   2. web-audio routing → when a WS client is connected, ship generated audio to it via broadcast
// plus a re-export facade of the core TTS functions for other desktop services.
import type { HandleRegistrar } from "../../core/dispatch";
import { broadcast } from "../../core/utils/broadcast";
import { hasWebClients } from "../../core/services/webServer";
import {
  stop,
  speak,
  speakResponse,
  speakMessage,
  validateConfig,
  detectPlayers,
  listSayVoices,
  setSpeakingStateListener,
  setWebAudioSink,
} from "../../core/handlers/tts";

// ─── Speaking-state notification ────────────────────────────
// No webContents.send under deno desktop; the uiBridge fans broadcast() out to the WS renderer.

setSpeakingStateListener((speaking, messageId) => {
  broadcast("tts:stateChange", { speaking, messageId });
});

// ─── Web audio routing ──────────────────────────────────────
//
// When a web client is connected, ship generated audio to the browser so it plays there (the local
// audio player would otherwise play on the server). `active()` returning true signals the core TTS
// pipeline to skip local playback.

setWebAudioSink({
  active: () => hasWebClients(),
  send: (audio) => broadcast("tts:audio", audio),
});

// ─── Re-exports (for other desktop-service consumers) ───────

export { stop, speak, speakResponse, speakMessage, validateConfig, detectPlayers, listSayVoices };

// ─── Handler registration ───────────────────────────────────
// tts:* channels are owned by core dispatch (registerTtsHandlers, wired centrally). Nothing to
// register here; kept for the uniform registrar contract used by the orchestrator's bridge.

export function registerHandlers(_dispatch: HandleRegistrar, _db: unknown): void {
  // Intentionally empty — see note above.
}
