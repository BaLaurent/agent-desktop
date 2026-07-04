/**
 * Apply MCP-related and tool-allowance settings to a SDK queryOptions dict.
 *
 * Ported from src/main/services/sessionManager/configureMcp.ts — Electron-free; imports
 * unchanged (all core-relative).
 *
 * This is a thin wrapper around `applyAiSettingsToQueryOptions` (core/services).
 * The actual logic — mcpServers preparation, allowedTools wildcards
 * (`mcp__<server>__*` REQUIRED for the SDK to permit MCP tools, even under
 * bypassPermissions), tools filtering, skills overrides — lives in
 * core/services/sdkQueryOptions.ts so the headless runtime can reuse it.
 *
 * Kept here as a named seam so sessionManager.createSession reads as four
 * orchestrated steps (auth / build / configure / wire) rather than a flat
 * 150-line function. No behavioural change; this function MUST remain
 * intent-preserving with the original inline call.
 */
import { applyAiSettingsToQueryOptions } from "../../../core/services/sdkQueryOptions";
import type { AISettings } from "../../../core/services/streaming";

export function configureMcp(
  queryOptions: Record<string, unknown>,
  aiSettings: AISettings,
): void {
  applyAiSettingsToQueryOptions(queryOptions, aiSettings);
}
