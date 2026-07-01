// PI (Oh My Pi) extension-UI channel — main→renderer push + response routing.
//
// The renderer's extension-UI surface (ExtensionDialog/Toast/Widget via
// usePiExtensionUI → piExtensionUIStore) consumes three IPC channels:
//   - `pi:uiRequest`  : interactive dialogs (select/confirm/input/editor) needing a reply
//   - `pi:uiEvent`    : fire-and-forget events (notify/setWidget/setStatus/…)
//   - `pi:uiResponse` : the renderer's answer to a `pi:uiRequest` (renderer→main)
//
// Under the omp RPC backend the live client lives inside a per-turn
// `streamMessageOmp` invocation in core, so main cannot subscribe to it or route
// responses back directly. This module is the single seam: the adapter layer
// (Electron main / headless) injects a `sender` for the push direction, and the
// omp UI bridge registers a `responder` per request so `respondPIUI` (driven by
// the main-process `pi:uiResponse` listener) can resolve it. One registry, one
// authoritative response path — no parallel mechanism.

import { broadcast } from '../../utils/broadcast'
import type { PiUIEvent, PiUIDialog, PiUIResponse } from '../../types/piUITypes'

/** Push a UI frame to the renderer. Injected by the adapter (webContents.send / broadcast). */
type PIUISenderFn = (channel: string, payload: unknown) => void

let _sender: PIUISenderFn | null = null

/** Inject the main→renderer UI sender. Called by the adapter layer. */
export function setPIUISender(fn: PIUISenderFn | null): void {
  _sender = fn
}

// Registry mapping a UI request id → the responder that answers the omp client.
const pendingUI = new Map<string, (response: PiUIResponse) => void>()

/** Emit a fire-and-forget UI event (notify/setWidget/setStatus/…). */
export function emitPIUIEvent(event: PiUIEvent): void {
  // Local Electron renderer (IPC) + headless/LAN WS clients (broadcast) —
  // mirrors sendChunk's dual fanout so both transports receive the event.
  _sender?.('pi:uiEvent', event)
  broadcast('pi:uiEvent', event)
}

/**
 * Emit an interactive UI request (dialog). `responder` is invoked exactly once
 * when the renderer answers (via `respondPIUI`) or the request is cancelled.
 * Register the responder BEFORE pushing so a synchronous transport can never
 * race the map insertion.
 */
export function emitPIUIRequest(request: PiUIDialog, responder: (response: PiUIResponse) => void): void {
  pendingUI.set(request.id, responder)
  _sender?.('pi:uiRequest', request)
  broadcast('pi:uiRequest', request)
}

/** Route a renderer response back to its pending request. No-op if unknown/stale. */
export function respondPIUI(response: PiUIResponse): void {
  const responder = pendingUI.get(response.id)
  if (!responder) return
  pendingUI.delete(response.id)
  responder(response)
}

/** Cancel every pending UI request (e.g. on turn end / client stop). */
export function cancelPendingPIUI(): void {
  for (const [id, responder] of pendingUI) {
    pendingUI.delete(id)
    responder({ id, cancelled: true })
  }
}
