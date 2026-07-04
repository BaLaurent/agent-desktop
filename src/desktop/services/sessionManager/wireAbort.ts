/**
 * Per-conversation abort plumbing for a new SDK session.
 *
 * Ported from src/main/services/sessionManager/wireAbort.ts — Electron-free; imports
 * unchanged (core-relative).
 *
 * Creates a fresh AbortController, registers it in the shared
 * `abortControllers` Map keyed by conversationId (consumed by abortSession()
 * and reconnectOrBreak()), and writes it into queryOptions.abortController so
 * the SDK subprocess receives the abort signal.
 *
 * Returns the controller so the caller can hold a reference if needed; the
 * caller is also responsible for stripping `abortController` from the saved
 * `queryOptions` snapshot used at reconnect time, because reconnect always
 * rebuilds a fresh controller.
 */
// Import directly from core to avoid the helper → streaming → sessionManager cycle.
import { abortControllers } from "../../../core/services/streaming";

export function wireAbort(
  conversationId: number,
  queryOptions: Record<string, unknown>,
): AbortController {
  const abortController = new AbortController();
  abortControllers.set(conversationId, abortController);
  queryOptions.abortController = abortController;
  return abortController;
}
