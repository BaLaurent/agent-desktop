/**
 * Build the SDK Query options object for a brand-new session.
 *
 * Pure-ish: takes inputs (settings, system prompt, optional resume id) and
 * returns the options dict the SDK's `query({ options })` expects, MINUS the
 * runtime-only fields that must be wired by the caller after construction:
 *
 *   - `canUseTool` (needs the session's pendingRequests Map)
 *   - `abortController` (per-conversation, lives in abortControllers Map)
 *
 * Behaviour preserved from the inline version in sessionManager.createSession:
 *   - permissionMode falls back to `'bypassPermissions'` when missing/invalid
 *   - `bypassPermissions` is the ONLY mode that sets
 *     `allowDangerouslySkipPermissions = true`
 *   - resume id is forwarded as `resume` when provided (SDK session resume)
 *   - executable / pathToClaudeCodeExecutable resolution mirrors streaming.ts
 *     (forces the system claude binary on glibc to dodge the bundled musl
 *     variant the SDK ships)
 *   - includePartialMessages is always true (we render streamed deltas)
 */
import { findBinaryInPath } from '../../utils/env'
import type { AISettings } from '../../../core/services/streaming'

const VALID_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'] as const
export type ValidPermissionMode = typeof VALID_PERMISSION_MODES[number]

export function resolvePermissionMode(raw: string | undefined): ValidPermissionMode {
  const fallback = 'bypassPermissions'
  if (!raw) return fallback
  return (VALID_PERMISSION_MODES as readonly string[]).includes(raw)
    ? raw as ValidPermissionMode
    : fallback
}

export interface BuildQueryOptionsInput {
  systemPrompt: string | undefined
  aiSettings: AISettings
  sdkSessionId: string | null
}

export interface BuildQueryOptionsResult {
  queryOptions: Record<string, unknown>
  permMode: ValidPermissionMode
}

export function buildQueryOptions({
  systemPrompt,
  aiSettings,
  sdkSessionId,
}: BuildQueryOptionsInput): BuildQueryOptionsResult {
  const permMode = resolvePermissionMode(aiSettings?.permissionMode)

  const nodeExecutable = findBinaryInPath('node') ?? 'node'
  const claudeExecutable = findBinaryInPath('claude')

  const thinkingBudget = aiSettings?.maxThinkingTokens
  const queryOptions: Record<string, unknown> = {
    model: aiSettings?.model || undefined,
    systemPrompt: systemPrompt || undefined,
    maxTurns: aiSettings?.maxTurns || undefined,
    // Prefer the non-deprecated `thinking` config. The SDK's `maxThinkingTokens`
    // is treated as on/off on Opus 4.6 — explicit budgetTokens is more reliable.
    ...(thinkingBudget && thinkingBudget > 0
      ? { thinking: { type: 'enabled', budgetTokens: thinkingBudget } }
      : {}),
    maxThinkingTokens: thinkingBudget || undefined,
    maxBudgetUsd: aiSettings?.maxBudgetUsd || undefined,
    cwd: aiSettings?.cwd || undefined,
    includePartialMessages: true,
    permissionMode: permMode,
    executable: nodeExecutable,
    ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
  }

  // Resume an existing SDK session when the conversation has one persisted.
  if (sdkSessionId) {
    queryOptions.resume = sdkSessionId
  }

  // bypassPermissions is the only mode that disables the SDK's own permission
  // prompts at the subprocess level — the rest go through canUseTool.
  if (permMode === 'bypassPermissions') {
    queryOptions.allowDangerouslySkipPermissions = true
  }

  return { queryOptions, permMode }
}
