/**
 * Auth env setup for a new SDK session.
 *
 * Ported from src/main/services/sessionManager/setupAuth.ts — Electron-free; the only import
 * change is ensureFreshMacOSToken, which moved from src/main/utils/env to the co-located
 * ./macosToken port (the macOS OAuth slice had no core home).
 *
 * Two responsibilities, both env-mutating:
 *   1. macOS OAuth token freshness (only when no explicit apiKey override).
 *   2. Inject ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL into process.env for the
 *      duration of the SDK subprocess; returns a `restoreEnv()` thunk the
 *      caller MUST invoke on session teardown to put the previous values
 *      back. Returns `null` when nothing was injected (no apiKey override).
 */
import { ensureFreshMacOSToken } from "./macosToken";
// Import directly from core to avoid the helper → streaming → sessionManager cycle.
import { injectApiKeyEnv } from "../../../core/services/streaming";
import type { AISettings } from "../../../core/services/streaming";

export async function setupAuth(aiSettings: AISettings): Promise<(() => void) | null> {
  if (!aiSettings?.apiKey) {
    await ensureFreshMacOSToken();
  }
  return injectApiKeyEnv(aiSettings?.apiKey, aiSettings?.baseUrl);
}
