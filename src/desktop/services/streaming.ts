// Ported from src/main/services/streaming.ts (the Electron streaming adapter).
//
// The Electron adapter did five things; under `deno desktop` only ONE survives here:
//
//   1. registerStreamWindow / Set<BrowserWindow> + setChunkSender webContents.send fanout
//        → REDUNDANT. Core sendChunk (core/services/streaming.ts:133-137) and
//          notifyConversationUpdated (:716-717) ALREADY call broadcast(...) unconditionally;
//          the desktop's Broadcaster port routes broadcast() → uiBridge → WS renderer.
//          _chunkSender was only an Electron-extra path. Dropped entirely.
//   2. setPIUISender(webContents.send fanout)
//        → REDUNDANT. piUIChannel.emitPIUIEvent/emitPIUIRequest ALREADY call
//          broadcast('pi:uiEvent'|'pi:uiRequest', ...) unconditionally (piUIChannel.ts:34-51).
//          Headless never sets a PI UI sender either — it relies on that broadcast. So the
//          desktop leaves _sender null; no setPIUISender call is needed anywhere.
//   3. ipcMain.on('pi:uiResponse', ...) → respondPIUI
//        → PORTED HERE as dispatch.handle('pi:uiResponse', ...). This is the renderer→main
//          leg (the renderer answering a pi:uiRequest); it has no broadcast twin, so the
//          handler is genuinely required for interactive PI extension-UI dialogs to resolve.
//   4/5. setPIBackend / setSessionManager / setPISchedulerBridge / setEnsureFreshToken
//        → NOT streaming's concern here. main.ts already calls setPIBackend(streamMessageOmp)
//          (omp-only path, mirroring headless). The remaining injectables belong to their own
//          service/env porters (scheduler bridge, macOS OAuth) and are out of this slice.
import type { HandleRegistrar } from "../../core/dispatch";
import { respondPIUI } from "../../core/services/pi/piUIChannel";
import type { PiUIResponse } from "../../core/types/piUITypes";

// Narrow the wire payload ({ ...response, id }, per preload/index.ts respondUI) to a PiUIResponse.
// respondPIUI keys off `id`; value/confirmed/cancelled are forwarded to the omp responder.
function toPiUIResponse(raw: unknown): PiUIResponse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== "string") return null;
  const response: PiUIResponse = { id: rec.id };
  if (typeof rec.value === "string") response.value = rec.value;
  if (typeof rec.confirmed === "boolean") response.confirmed = rec.confirmed;
  if (typeof rec.cancelled === "boolean") response.cancelled = rec.cancelled;
  return response;
}

export function registerHandlers(dispatch: HandleRegistrar, _db: unknown): void {
  // Renderer's answer to a pi:uiRequest dialog. Electron used a one-way ipcMain.on; under the
  // dispatch model it is a fire-and-forget invoke whose result the shim ignores.
  dispatch.handle("pi:uiResponse", (_event, response: unknown) => {
    const parsed = toPiUIResponse(response);
    if (parsed) respondPIUI(parsed);
  });
}
