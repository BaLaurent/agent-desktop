import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import type { Broadcaster } from '../ports/broadcaster'
import type { HookRunner } from '../ports/hookRunner'
import type { AISettings } from '../services/streaming'
import type { Message, Attachment, ToolCall, ToolApprovalResponse, AskUserResponse } from '../types/types'
import { abortStream, respondToApproval, sendChunk, notifyConversationUpdated, injectApiKeyEnv } from '../services/streaming'
import { summarizeWithModel } from '../services/summarization'
import { validateString, validatePositiveInt, validatePathSafe } from '../utils/validate'
import { HAIKU_MODEL } from '../types/constants'
import { mkdirSync } from 'fs'
import { promises as fsp } from 'fs'
import { join, basename, extname } from 'path'

import { assembleSystemPrompt } from './messages/knowledgeBase'
import { assembleAISettings } from './messages/modelResolver'
import {
  readRetrySettings,
  sleep,
  runUserPromptHooks,
  runStreamAttempt,
  persistTurnUsage,
  composeAssistantContent,
  emitRetryChunk,
  fireWebhookCompletion,
  fireTts,
} from './messages/streamPhases'
import type { MessageStreamContext } from './messages/types'
import { createLogger } from '../utils/logger'

const log = createLogger('messages')

// ─── Options ──────────────────────────────────────────────────

export interface MessagesHandlerOptions {
  broadcaster: Broadcaster
  hookRunner: HookRunner
  sessionsBase: string
  knowledgesDir?: string
  supportedKnowledgeExts?: Set<string>
  onTtsSpeak?: (content: string, conversationId: number, aiSettings: AISettings) => void
  onTtsStop?: () => void
  onWebhookFire?: (url: string, payload: Record<string, unknown>) => void
  getSchedulerMcpConfig?: (conversationId: number) => Record<string, unknown> | null
  onSessionInvalidate?: (conversationId: number) => void
}

// ─── Internal State ───────────────────────────────────────────

const streamGenerations = new Map<number, number>()

const CWD_CACHE_MAX = 1000
const cwdCache = new Map<number, string>()

function invalidateCwdCache(conversationId: number): void {
  cwdCache.delete(conversationId)
}

/** Increment the generation counter for a conversation, cancelling any pending retry */
function invalidateRetry(conversationId: number): void {
  streamGenerations.set(conversationId, (streamGenerations.get(conversationId) ?? 0) + 1)
}

// ─── Attachment Helpers ───────────────────────────────────────

async function uniqueDestPath(dir: string, name: string): Promise<string> {
  let candidate = join(dir, name)
  try { await fsp.access(candidate) } catch { return candidate }
  const ext = extname(name)
  const base = basename(name, ext)
  let i = 1
  while (i < 1000) {
    candidate = join(dir, `${base}_${i}${ext}`)
    try { await fsp.access(candidate) } catch { return candidate }
    i++
  }
  return candidate
}

// consumed by messages.cascade.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export async function copyAttachmentsToSession(
  cwd: string,
  attachments: Attachment[]
): Promise<{ copied: Attachment[]; contentSuffix: string }> {
  if (!attachments.length) return { copied: attachments, contentSuffix: '' }

  const attachDir = join(cwd, 'attachments')
  await fsp.mkdir(attachDir, { recursive: true })

  const copied: Attachment[] = []
  const lines: string[] = []
  for (const att of attachments) {
    const destPath = await uniqueDestPath(attachDir, att.name)
    await fsp.copyFile(att.path, destPath)
    const finalName = basename(destPath)
    copied.push({ ...att, name: finalName, path: destPath })
    lines.push(`[${finalName}](${destPath})`)
  }

  const contentSuffix = '\n\n' + lines.join('\n')
  return { copied, contentSuffix }
}

// ─── Message History ──────────────────────────────────────────

export function buildMessageHistory(db: SqlJsAdapter, conversationId: number, limit = 100): Array<{ role: 'user' | 'assistant'; content: string }> {
  const conv = (db as any).prepare('SELECT cleared_at, compact_summary FROM conversations WHERE id = ?').get(conversationId) as { cleared_at: string | null; compact_summary: string | null } | undefined

  let query = 'SELECT role, content FROM messages WHERE conversation_id = ?'
  const params: (number | string)[] = [conversationId]

  if (conv?.cleared_at) {
    query += ' AND created_at > ?'
    params.push(conv.cleared_at)
  }

  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const rows = (db as any).prepare(query).all(...params) as Pick<Message, 'role' | 'content'>[]

  // Strip <thinking> blocks from past assistant turns. They are persisted for
  // user-side replay only; the SDK cannot replay them without the matching
  // signature_delta (not captured), and feeding them back as raw text would
  // confuse the model about the shape of its own past output.
  const result = rows.reverse().map((row) => ({
    role: row.role,
    content: row.role === 'assistant'
      ? row.content.replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, '')
      : row.content,
  }))

  if (conv?.compact_summary) {
    result.unshift({ role: 'assistant', content: `[Previous conversation summary]\n${conv.compact_summary}` })
  }

  return result
}

// ─── System Prompt ────────────────────────────────────────────

/**
 * Public entry point for the conversation system prompt. Thin wrapper
 * around `assembleSystemPrompt` — cascade lookups, knowledge-base
 * ingestion, and the scheduler directive live in
 * `messages/knowledgeBase.ts`.
 */
export function getSystemPrompt(
  db: SqlJsAdapter,
  conversationId: number,
  cwd: string,
  opts?: { knowledgesDir?: string; supportedKnowledgeExts?: Set<string>; getSchedulerMcpConfig?: (id: number) => Record<string, unknown> | null }
): Promise<string> {
  return assembleSystemPrompt(db, conversationId, cwd, opts)
}

// ─── CWD Resolution ───────────────────────────────────────────

function getConversationCwd(db: SqlJsAdapter, conversationId: number, sessionsBase: string): string {
  const cached = cwdCache.get(conversationId)
  if (cached) return cached

  if (cwdCache.size >= CWD_CACHE_MAX) {
    const firstKey = cwdCache.keys().next().value!
    cwdCache.delete(firstKey)
  }

  const row = (db as any)
    .prepare('SELECT cwd FROM conversations WHERE id = ?')
    .get(conversationId) as { cwd: string | null } | undefined

  let cwd: string
  if (row?.cwd) {
    cwd = validatePathSafe(row.cwd)
  } else {
    cwd = join(sessionsBase, String(conversationId))
    cwd = validatePathSafe(cwd, sessionsBase)
  }

  mkdirSync(cwd, { recursive: true })
  cwdCache.set(conversationId, cwd)
  return cwd
}

// ─── AI Settings ──────────────────────────────────────────────

/**
 * Public entry point for per-conversation AI settings. Resolves the
 * conversation cwd via the local cache, then delegates to
 * `assembleAISettings` which handles the cascade, MCP server
 * selection, and model resolution.
 */
export function getAISettings(
  db: SqlJsAdapter,
  conversationId: number,
  opts?: { sessionsBase: string; knowledgesDir?: string; getSchedulerMcpConfig?: (id: number) => Record<string, unknown> | null },
): AISettings {
  const cwd = getConversationCwd(db, conversationId, opts?.sessionsBase ?? '')
  return assembleAISettings(db, conversationId, {
    cwd,
    knowledgesDir: opts?.knowledgesDir,
    getSchedulerMcpConfig: opts?.getSchedulerMcpConfig,
  })
}

// ─── Message Persistence ──────────────────────────────────────

export function saveMessage(
  db: SqlJsAdapter,
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  attachments: Attachment[] = [],
  toolCalls?: ToolCall[]
): Message {
  const now = new Date().toISOString()
  const toolCallsJson = toolCalls?.length ? JSON.stringify(toolCalls) : null
  const result = (db as any)
    .prepare(
      `INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(conversationId, role, content, JSON.stringify(attachments), toolCallsJson, now, now)

  return {
    id: result.lastInsertRowid as number,
    conversation_id: conversationId,
    role,
    content,
    attachments: JSON.stringify(attachments),
    tool_calls: toolCallsJson,
    created_at: now,
    updated_at: now,
  }
}

// ─── SDK Session CRUD ─────────────────────────────────────────

function getConversationSdkSessionId(db: SqlJsAdapter, conversationId: number): string | null {
  const row = (db as any).prepare('SELECT sdk_session_id FROM conversations WHERE id = ?').get(conversationId) as { sdk_session_id: string | null } | undefined
  return row?.sdk_session_id ?? null
}

function saveConversationSdkSessionId(db: SqlJsAdapter, conversationId: number, sessionId: string): void {
  (db as any).prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?').run(sessionId, conversationId)
}

// Invalidates BOTH session IDs (Claude SDK and PI) — call on any history mutation that breaks session continuity
function invalidateAllSessions(db: SqlJsAdapter, conversationId: number): void {
  (db as any).prepare('UPDATE conversations SET sdk_session_id = NULL, pi_session_file = NULL WHERE id = ?').run(conversationId)
}

export function getConversationPiSessionFile(db: SqlJsAdapter, conversationId: number): string | null {
  const row = (db as any).prepare('SELECT pi_session_file FROM conversations WHERE id = ?').get(conversationId) as { pi_session_file: string | null } | undefined
  return row?.pi_session_file ?? null
}

export function setConversationPiSessionFile(db: SqlJsAdapter, conversationId: number, filepath: string | null): void {
  (db as any).prepare('UPDATE conversations SET pi_session_file = ? WHERE id = ?').run(filepath, conversationId)
}

function updateConversationTimestamp(db: SqlJsAdapter, conversationId: number): void {
  (db as any).prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    conversationId
  )
}

// ─── Last User Message ────────────────────────────────────────

function buildLastUserMessage(
  db: SqlJsAdapter,
  conversationId: number
): Array<{ role: Message['role']; content: string }> {
  const row = (db as any).prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(conversationId) as Pick<Message, 'role' | 'content'> | undefined
  return row ? [{ role: row.role, content: row.content }] : []
}

// ─── Stream and Save ──────────────────────────────────────────

/**
 * Build the per-stream context and run UserPromptSubmit hooks. Bumps the
 * generation counter so any in-flight retry from a previous stream is
 * silently abandoned (CLAUDE.md > "Stream isolation").
 */
async function prepareStreamContext(
  db: SqlJsAdapter,
  conversationId: number,
  options: MessagesHandlerOptions,
): Promise<MessageStreamContext> {
  options.onTtsStop?.()

  const generation = (streamGenerations.get(conversationId) ?? 0) + 1
  streamGenerations.set(conversationId, generation)

  const sdkSessionId = getConversationSdkSessionId(db, conversationId)
  // SDK session resume only needs the trailing user turn; full history is
  // rebuilt on retry when the saved session id is rejected by the SDK.
  const messages = sdkSessionId
    ? buildLastUserMessage(db, conversationId)
    : buildMessageHistory(db, conversationId)

  const aiSettings = getAISettings(db, conversationId, {
    sessionsBase: options.sessionsBase,
    knowledgesDir: options.knowledgesDir,
    getSchedulerMcpConfig: options.getSchedulerMcpConfig,
  })
  const systemPrompt = await getSystemPrompt(db, conversationId, aiSettings.cwd!, {
    knowledgesDir: options.knowledgesDir,
    supportedKnowledgeExts: options.supportedKnowledgeExts,
    getSchedulerMcpConfig: options.getSchedulerMcpConfig,
  })

  const hookSystemContents = await runUserPromptHooks(conversationId, messages, aiSettings, options)

  return {
    db,
    conversationId,
    generation,
    sdkSessionId,
    messages: messages as Array<{ role: 'user' | 'assistant'; content: string }>,
    aiSettings,
    systemPrompt,
    hookSystemContents,
    options,
  }
}

/**
 * Persist a successful assistant turn: token usage, session id, the
 * assistant message itself, then fire webhook + TTS side effects.
 * Returns null when the conversation has been deleted mid-stream.
 */
async function persistAssistantTurn(
  ctx: MessageStreamContext,
  payload: import('./messages/streamPhases').AssistantTurnPayload & { aborted: boolean },
): Promise<Message | null> {
  const { db, conversationId, hookSystemContents, options } = ctx

  await persistTurnUsage(db, ctx, payload)

  if (payload.newSessionId) {
    saveConversationSdkSessionId(db, conversationId, payload.newSessionId)
  }
  const exists = (db as any).prepare('SELECT 1 FROM conversations WHERE id = ?').get(conversationId)
  if (!exists) return null

  const finalContent = composeAssistantContent(payload.responseContent, hookSystemContents)
  const assistantMsg = saveMessage(db, conversationId, 'assistant', finalContent, [], payload.toolCalls)
  updateConversationTimestamp(db, conversationId)
  notifyConversationUpdated(conversationId)

  fireWebhookCompletion(db, ctx, payload, assistantMsg)
  fireTts(ctx, payload)
  void options // referenced through ctx
  return assistantMsg
}

async function streamAndSave(
  db: SqlJsAdapter,
  conversationId: number,
  options: MessagesHandlerOptions,
): Promise<Message | null> {
  const ctx = await prepareStreamContext(db, conversationId, options)

  const retrySettings = readRetrySettings(db)
  const maxAttempts = retrySettings.enabled ? retrySettings.maxAttempts : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (streamGenerations.get(conversationId) !== ctx.generation) return null

    const attemptSessionId = attempt === 1 ? ctx.sdkSessionId : null
    const attemptMessages = attempt === 1 ? ctx.messages : buildMessageHistory(db, conversationId)

    try {
      const payload = await runStreamAttempt(attemptMessages, attemptSessionId, ctx)

      // Persist token usage even when the turn ends without content — the
      // status-line bar should reflect tool-only turns too.
      if (payload.usage) await persistTurnUsage(db, ctx, payload)

      if (payload.aborted) return null

      if (payload.responseContent) {
        return persistAssistantTurn(ctx, payload)
      }

      if (!payload.error) return null

      // Error with no content — invalidate session and retry or surface.
      if (attemptSessionId) {
        invalidateAllSessions(db, conversationId)
      }
      options.onSessionInvalidate?.(conversationId)

      if (attempt < maxAttempts) {
        const delay = retrySettings.initialDelayMs * Math.pow(2, attempt - 1)
        emitRetryChunk(conversationId, attempt, maxAttempts, delay, payload.error)
        await sleep(delay)
        if (streamGenerations.get(conversationId) !== ctx.generation) return null
        continue
      }

      sendChunk('error', payload.error, { conversationId })
      return null
    } catch (err) {
      // SDK session resume failure on the first attempt — clear the saved
      // session id and let the loop rebuild full history on attempt 2.
      if (attempt === 1 && ctx.sdkSessionId) {
        log.warn('SDK session resume failed, retrying with full history', err)
        invalidateAllSessions(db, conversationId)
        options.onSessionInvalidate?.(conversationId)
        continue
      }
      log.error('Stream error', err)
      return null
    }
  }

  return null
}

// ─── Title Generation ─────────────────────────────────────────

async function generateConversationTitle(
  db: SqlJsAdapter,
  conversationId: number,
  userContent: string,
  assistantContent: string,
  options: MessagesHandlerOptions
): Promise<void> {
  const cleanAssistant = assistantContent
    .replace(/<hook-system-message>[\s\S]*?<\/hook-system-message>\n?/g, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, '')
    .trimStart()
  const userSnippet = userContent.slice(0, 200)
  const assistantSnippet = cleanAssistant.slice(0, 200)

  const aiSettings = getAISettings(db, conversationId, {
    sessionsBase: options.sessionsBase,
    knowledgesDir: options.knowledgesDir,
    getSchedulerMcpConfig: options.getSchedulerMcpConfig,
  })
  const effectiveModel = aiSettings.titleModel || aiSettings.model || HAIKU_MODEL
  const restoreEnv = injectApiKeyEnv(aiSettings.apiKey, aiSettings.baseUrl)

  try {
    const rawTitle = await summarizeWithModel(
      `Generate a very short title (3-6 words) for this conversation. Reply with ONLY the title — no quotes, no explanation.\nUser: ${userSnippet}\nAssistant: ${assistantSnippet}`,
      effectiveModel,
      { cwd: aiSettings.cwd || process.cwd(), apiKey: aiSettings.apiKey, baseUrl: aiSettings.baseUrl },
    )

    const title = rawTitle.trim().replace(/^["']|["']$/g, '').slice(0, 80)

    if (!title) {
      log.warn('Auto-title: empty title generated', { conversationId })
      return
    }

    log.info('Auto-title', { title, conversationId })
    ;(db as any).prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId)

    options.broadcaster.broadcast('conversations:titleUpdated', { id: conversationId, title })
  } finally {
    restoreEnv?.()
  }
}

// ─── Compact Conversation ─────────────────────────────────────

export async function compactConversation(
  db: SqlJsAdapter,
  conversationId: number,
  options: MessagesHandlerOptions
): Promise<{ summary: string; clearedAt: string }> {
  const history = buildMessageHistory(db, conversationId)
  if (history.length === 0) {
    const clearedAt = new Date().toISOString()
    ;(db as any).prepare('UPDATE conversations SET cleared_at = ?, compact_summary = NULL, pi_session_file = NULL, updated_at = ? WHERE id = ?')
      .run(clearedAt, clearedAt, conversationId)
    return { summary: '', clearedAt }
  }

  const conversationText = history
    .map((m) => {
      const stripped = m.role === 'assistant'
        ? m.content.replace(/<thinking>[\s\S]*?<\/thinking>\n?/g, '')
        : m.content
      return `${m.role === 'user' ? 'User' : 'Assistant'}: ${stripped}`
    })
    .join('\n\n')

  const aiSettings = getAISettings(db, conversationId, {
    sessionsBase: options.sessionsBase,
    knowledgesDir: options.knowledgesDir,
    getSchedulerMcpConfig: options.getSchedulerMcpConfig,
  })
  const effectiveModel = aiSettings.compactModel || aiSettings.model || HAIKU_MODEL
  const restoreEnv = injectApiKeyEnv(aiSettings.apiKey, aiSettings.baseUrl)

  try {
    const summary = await summarizeWithModel(
      `Summarize the following conversation into a concise context summary that preserves all key information, decisions, code changes, file paths, and important details. The summary will replace the full conversation history, so it must capture everything needed to continue the conversation seamlessly. Write the summary as a factual recap, not as a conversation. Do NOT wrap it in quotes or add a preamble.\n\n${conversationText}`,
      effectiveModel,
      { cwd: aiSettings.cwd || process.cwd(), apiKey: aiSettings.apiKey, baseUrl: aiSettings.baseUrl },
    )

    const clearedAt = new Date().toISOString()
    ;(db as any).prepare('UPDATE conversations SET cleared_at = ?, compact_summary = ?, sdk_session_id = NULL, pi_session_file = NULL, updated_at = ? WHERE id = ?')
      .run(clearedAt, summary || null, clearedAt, conversationId)
    options.onSessionInvalidate?.(conversationId)

    return { summary, clearedAt }
  } finally {
    restoreEnv?.()
  }
}

// ─── Handler Registration ─────────────────────────────────────

export function registerMessagesHandlers(
  registrar: HandleRegistrar,
  db: SqlJsAdapter,
  options: MessagesHandlerOptions
): void {
  registrar.handle(
    'messages:send',
    async (_event, conversationId: unknown, content: unknown, attachments?: unknown) => {
      const validConvId = validatePositiveInt(conversationId, 'conversationId')
      const validContent = validateString(content, 'content', 10_000_000)
      const atts = attachments as Attachment[] | undefined

      const cwd = getConversationCwd(db, validConvId, options.sessionsBase)
      let finalContent = validContent
      let savedAttachments = atts
      if (atts?.length) {
        const { copied, contentSuffix } = await copyAttachmentsToSession(cwd, atts)
        savedAttachments = copied
        finalContent = validContent + contentSuffix
      }

      saveMessage(db, validConvId, 'user', finalContent, savedAttachments)
      updateConversationTimestamp(db, validConvId)

      const assistantMsg = await streamAndSave(db, validConvId, options)

      // Auto-title on first assistant response (skip Quick Chat)
      if (assistantMsg) {
        const quickChatRow = (db as any).prepare("SELECT value FROM settings WHERE key = 'quickChat_conversationId'").get() as { value: string } | undefined
        const isQuickChat = quickChatRow?.value === String(validConvId)
        if (!isQuickChat) {
          const assistantCount = (db as any).prepare(
            "SELECT COUNT(*) as c FROM messages WHERE conversation_id = ? AND role = 'assistant'"
          ).get(validConvId) as { c: number }
          if (assistantCount.c === 1) {
            generateConversationTitle(db, validConvId, validContent, assistantMsg.content, options)
              .catch(err => log.error('Auto-title error', err))
          }
        }
      }

      return assistantMsg
    }
  )

  registrar.handle('messages:compact', async (_event, conversationId: unknown) => {
    const validConvId = validatePositiveInt(conversationId, 'conversationId')
    return compactConversation(db, validConvId, options)
  })

  registrar.handle('context:getSkillsOverhead', async (_event, cwd?: unknown) => {
    const { computeSkillsOverheadPerMode } = await import('../services/contextBreakdown')
    return computeSkillsOverheadPerMode(typeof cwd === 'string' ? cwd : undefined)
  })

  registrar.handle('context:getBreakdown', async (_event, conversationId: unknown) => {
    const validConvId = validatePositiveInt(conversationId, 'conversationId')
    const { buildContextBreakdown } = await import('../services/contextBreakdown')

    const modeSetting = (db as any).prepare("SELECT value FROM settings WHERE key = 'ai_contextTokenCounter'")
      .get() as { value: string } | undefined
    const mode = (modeSetting?.value === 'anthropic' ? 'anthropic' : 'local') as 'local' | 'anthropic'

    const aiSettings = getAISettings(db, validConvId, {
      sessionsBase: options.sessionsBase,
      knowledgesDir: options.knowledgesDir,
      getSchedulerMcpConfig: options.getSchedulerMcpConfig,
    })
    // Force 'local' on PI backend — Anthropic count_tokens requires Claude auth/model.
    const effectiveMode: 'local' | 'anthropic' = aiSettings.sdkBackend === 'pi' ? 'local' : mode

    const cwd = aiSettings.cwd ?? getConversationCwd(db, validConvId, options.sessionsBase)
    const systemPrompt = await getSystemPrompt(db, validConvId, cwd, {
      knowledgesDir: options.knowledgesDir,
      supportedKnowledgeExts: options.supportedKnowledgeExts,
      getSchedulerMcpConfig: options.getSchedulerMcpConfig,
    })

    // TODO: when effectiveMode === 'anthropic', call the count_tokens endpoint
    // and pass the result as totalOverride. For now we return the local estimate.
    return buildContextBreakdown({
      db,
      conversationId: validConvId,
      systemPrompt,
      mode: effectiveMode,
      skillsMode: aiSettings.skillsEnabled === false ? 'off' : (aiSettings.skills ?? 'off'),
      cwd,
    })
  })

  registrar.handle('messages:stop', async (_event, conversationId?: unknown) => {
    if (conversationId != null) {
      validatePositiveInt(conversationId, 'conversationId')
      invalidateRetry(conversationId as number)
    }
    abortStream(conversationId as number | undefined)
  })

  registrar.handle(
    'messages:respondToApproval',
    async (_event, requestId: unknown, response: unknown) => {
      respondToApproval(requestId as string, response as ToolApprovalResponse | AskUserResponse)
    }
  )

  registrar.handle('messages:regenerate', async (_event, conversationId: unknown) => {
    const validConvId = validatePositiveInt(conversationId, 'conversationId')

    const lastAssistant = (db as any)
      .prepare(
        `SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(validConvId) as { id: number } | undefined

    if (lastAssistant) {
      (db as any).prepare('DELETE FROM messages WHERE id = ?').run(lastAssistant.id)
    }

    invalidateAllSessions(db, validConvId)
    options.onSessionInvalidate?.(validConvId)
    updateConversationTimestamp(db, validConvId)

    return streamAndSave(db, validConvId, options)
  })

  registrar.handle('messages:edit', async (_event, messageId: unknown, content: unknown) => {
    const validMsgId = validatePositiveInt(messageId, 'messageId')
    const validContent = validateString(content, 'content', 10_000_000)

    const msg = (db as any)
      .prepare('SELECT id, conversation_id, created_at FROM messages WHERE id = ?')
      .get(validMsgId) as { id: number; conversation_id: number; created_at: string } | undefined

    if (!msg) throw new Error('Message not found')

    ;(db as any).transaction(() => {
      (db as any).prepare('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?').run(
        validContent,
        new Date().toISOString(),
        validMsgId
      )
      ;(db as any).prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND id > ?'
      ).run(msg.conversation_id, msg.id)
      ;(db as any).prepare('UPDATE conversations SET sdk_session_id = NULL, pi_session_file = NULL WHERE id = ?').run(msg.conversation_id)
    })()
    options.onSessionInvalidate?.(msg.conversation_id)

    updateConversationTimestamp(db, msg.conversation_id)

    return streamAndSave(db, msg.conversation_id, options)
  })

  registrar.handle('conversations:generateTitle', async (_event, conversationId: unknown) => {
    const validConvId = validatePositiveInt(conversationId, 'conversationId')

    const firstUser = (db as any).prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1"
    ).get(validConvId) as { content: string } | undefined

    const firstAssistant = (db as any).prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at ASC LIMIT 1"
    ).get(validConvId) as { content: string } | undefined

    if (!firstUser) return

    await generateConversationTitle(
      db,
      validConvId,
      firstUser.content,
      firstAssistant?.content || '',
      options
    )
  })
}
