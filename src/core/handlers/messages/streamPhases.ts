// Phase helpers for `streamAndSave` in messages.ts.
//
// The streaming path has four logical phases:
//   1. prepare       — read settings, build history, run prompt hooks
//   2. attempt loop  — call streamMessage with retry/backoff
//   3. persist       — save assistant message, fire webhook, fire TTS
//   4. (error path)  — invalidate session, classify retry vs final
//
// CLAUDE.md gotchas honored here:
//   - SDK session retry: when `resume` throws, clear `sdk_session_id`
//     and rebuild full history on next attempt.
//   - Stream isolation: `streamGenerations` map keyed by conversationId
//     — a stale generation aborts the loop silently.
//   - Hook system messages: prepended to the assistant content as
//     `<hook-system-message>...</hook-system-message>` blocks.

import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import type { Message } from '../../types/types'
import type { AISettings } from '../../services/streaming'
import { streamMessage, sendChunk, notifyConversationUpdated } from '../../services/streaming'
import { createLogger } from '../../utils/logger'

const log = createLogger('streamPhases')
import type { MessageStreamContext, RetrySettings } from './types'
import type { MessagesHandlerOptions } from '../messages'

// ─── Retry settings ───────────────────────────────────────────

export function readRetrySettings(db: SqlJsAdapter): RetrySettings {
  const rows = (db as any)
    .prepare("SELECT key, value FROM settings WHERE key IN ('retry_enabled', 'retry_maxAttempts', 'retry_initialDelayMs')")
    .all() as { key: string; value: string }[]
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return {
    enabled: (map['retry_enabled'] ?? 'true') === 'true',
    maxAttempts: Math.max(1, Math.min(10, Number(map['retry_maxAttempts']) || 3)),
    initialDelayMs: Math.max(1000, Math.min(30000, Number(map['retry_initialDelayMs']) || 2000)),
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Hooks (UserPromptSubmit) ─────────────────────────────────

/**
 * Run UserPromptSubmit hooks for the trailing user message and emit
 * `system_message` chunks. Returns the raw hook contents so the caller
 * can later wrap them as `<hook-system-message>...` tags in the saved
 * assistant content.
 *
 * Skipped silently when:
 *   - no trailing user message (e.g. regenerate path with no user msg);
 *   - PI backend with `sharedHooks` disabled.
 */
export async function runUserPromptHooks(
  conversationId: number,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  aiSettings: AISettings,
  options: MessagesHandlerOptions,
): Promise<string[]> {
  const isClaudeBackend = aiSettings.sdkBackend !== 'pi'
  const runHooks = isClaudeBackend || aiSettings.sharedHooks !== false
  const lastUserMsg = messages[messages.length - 1]
  if (!runHooks || lastUserMsg?.role !== 'user') return []

  const hookMessages = await options.hookRunner.runUserPromptSubmitHooks(
    lastUserMsg.content,
    aiSettings.cwd || process.cwd(),
    aiSettings.permissionMode || 'bypassPermissions'
  )

  const hookSystemContents: string[] = []
  for (const msg of hookMessages) {
    sendChunk('system_message', msg.content, {
      hookEvent: msg.hookEvent,
      conversationId,
    })
    hookSystemContents.push(msg.content)
  }
  return hookSystemContents
}

// ─── Persistence helpers ──────────────────────────────────────

export interface AssistantTurnPayload {
  responseContent: string
  toolCalls: import('../../types/types').ToolCall[] | undefined
  newSessionId: string | null | undefined
  stopReason: string | undefined
  error: string | undefined
  usage: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    context_window?: number
  } | undefined
}

function saveConversationUsage(
  db: SqlJsAdapter,
  conversationId: number,
  usage: NonNullable<AssistantTurnPayload['usage']>,
): void {
  (db as any).prepare(
    `UPDATE conversations SET
       last_input_tokens = ?,
       last_output_tokens = ?,
       last_cache_read_tokens = ?,
       last_cache_creation_tokens = ?,
       last_context_window = ?,
       last_usage_updated_at = ?
     WHERE id = ?`
  ).run(
    usage.input_tokens ?? null,
    usage.output_tokens ?? null,
    usage.cache_read_input_tokens ?? null,
    usage.cache_creation_input_tokens ?? null,
    usage.context_window ?? null,
    new Date().toISOString(),
    conversationId
  )
}

/**
 * Compute the content-only token total (same math as the /context bubble
 * headline) and persist it on the conversation row. The status-line bar
 * reads this column so bubble and bar stay consistent by construction.
 *
 * Failures are non-fatal: a stale `last_content_tokens` lags by one turn,
 * better than aborting the whole response persistence.
 */
async function saveConversationContentTokens(
  db: SqlJsAdapter,
  conversationId: number,
  systemPrompt: string,
  aiSettings: AISettings,
): Promise<void> {
  const { buildContextBreakdown } = await import('../../services/contextBreakdown')
  const skillsMode = aiSettings.skillsEnabled === false
    ? 'off'
    : (aiSettings.skills ?? 'off')
  const breakdown = await buildContextBreakdown({
    db,
    conversationId,
    systemPrompt,
    skillsMode,
    cwd: aiSettings.cwd,
  })
  ;(db as any).prepare('UPDATE conversations SET last_content_tokens = ? WHERE id = ?').run(
    breakdown.total,
    conversationId
  )
}

export function fireWebhookCompletion(
  db: SqlJsAdapter,
  ctx: MessageStreamContext,
  payload: AssistantTurnPayload,
  assistantMsg: Message,
): void {
  const { aiSettings, options, conversationId } = ctx
  if (!aiSettings.webhookCompletionUrl || !options.onWebhookFire) return
  const convTitle = ((db as any).prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined)?.title ?? ''
  try {
    options.onWebhookFire(aiSettings.webhookCompletionUrl, {
      event: payload.error ? 'completion_with_error' : 'completion',
      conversationId,
      conversationTitle: convTitle,
      messageId: assistantMsg.id,
      content: payload.responseContent,
      model: aiSettings.model || '',
      stopReason: payload.stopReason,
      createdAt: assistantMsg.created_at,
      ...(payload.error ? { error: payload.error } : {}),
    })
  } catch (err) {
    log.error('Webhook error', err)
  }
}

export function fireTts(
  ctx: MessageStreamContext,
  payload: AssistantTurnPayload,
): void {
  const { aiSettings, options, conversationId } = ctx
  if (payload.error || !options.onTtsSpeak) return
  try {
    options.onTtsSpeak(payload.responseContent, conversationId, aiSettings)
  } catch (err) {
    log.error('Response TTS error', err)
  }
}

// ─── Attempt + retry coordination ─────────────────────────────

/**
 * Run a single streamMessage attempt and report the structured result.
 * Pure I/O delegation — no DB writes, no retry logic.
 */
export async function runStreamAttempt(
  attemptMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  attemptSessionId: string | null,
  ctx: MessageStreamContext,
): Promise<AssistantTurnPayload & { aborted: boolean }> {
  const result = await streamMessage(
    attemptMessages, ctx.systemPrompt, ctx.aiSettings, ctx.conversationId, attemptSessionId,
  )
  return {
    responseContent: result.content,
    toolCalls: result.toolCalls,
    newSessionId: result.sessionId,
    stopReason: result.stopReason,
    error: result.error,
    usage: result.usage,
    aborted: result.aborted,
  }
}

/**
 * Persist the usage block and trigger the broadcaster refetch. Best-effort:
 * a usage-save failure does not fail the stream.
 */
export async function persistTurnUsage(
  db: SqlJsAdapter,
  ctx: MessageStreamContext,
  payload: AssistantTurnPayload,
): Promise<void> {
  if (!payload.usage) return
  try {
    saveConversationUsage(db, ctx.conversationId, payload.usage)
    // Persist content-only total BEFORE notifying the client, so the
    // refetch triggered by `notifyConversationUpdated` already sees it.
    await saveConversationContentTokens(db, ctx.conversationId, ctx.systemPrompt, ctx.aiSettings)
      .catch((e) => log.warn('saveConversationContentTokens failed', e))
    notifyConversationUpdated(ctx.conversationId)
  } catch (e) {
    log.warn('saveConversationUsage failed', e)
  }
}

/**
 * Build the final assistant content, prepending hook system messages
 * (CLAUDE.md > "UserPromptSubmit hooks").
 */
export function composeAssistantContent(
  responseContent: string,
  hookSystemContents: string[],
): string {
  if (hookSystemContents.length === 0) return responseContent
  return hookSystemContents.map(c => `<hook-system-message>${c}</hook-system-message>`).join('\n')
    + '\n\n' + responseContent
}

/**
 * Emit a retry chunk for the next attempt. Callers compute and await
 * the delay themselves so the generation guard runs after sleep.
 */
export function emitRetryChunk(
  conversationId: number,
  attempt: number,
  maxAttempts: number,
  delay: number,
  error: string,
): void {
  log.warn('Attempt failed, retrying', { attempt, maxAttempts, delayMs: delay, error })
  sendChunk('retry', `Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${maxAttempts})...`, {
    conversationId,
    retryAttempt: attempt + 1,
    retryMaxAttempts: maxAttempts,
    retryDelayMs: delay,
  })
}
