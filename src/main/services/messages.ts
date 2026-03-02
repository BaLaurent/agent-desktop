import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { promises as fsp } from 'fs'
import { join, basename, extname, resolve, relative } from 'path'
import { app } from 'electron'
import { streamMessage, abortStream, respondToApproval, injectApiKeyEnv, notifyConversationUpdated, sendChunk } from './streaming'
import { invalidateSession } from './sessionManager'
import { runUserPromptSubmitHooks } from './hookRunner'
import { loadAgentSDK } from './anthropic'
import { getMainWindow } from '../index'
import { broadcast } from '../utils/broadcast'
import type { AISettings } from './streaming'
import type { Message, Attachment, ToolCall, ToolApprovalResponse, AskUserResponse, KnowledgeSelection, CwdWhitelistEntry } from '../../shared/types'
import { validateString, validatePositiveInt, validatePathSafe } from '../utils/validate'
import { getSchedulerMcpConfig } from './schedulerBridge'
import { speakResponse, stop as stopTts } from './tts'
import { safeJsonParse } from '../utils/json'
import { getKnowledgesDir, getSupportedExtensions } from './knowledge'
import { DEFAULT_MODEL, HAIKU_MODEL } from '../../shared/constants'

const SESSIONS_BASE = join(app.getPath('home'), '.agent-desktop', 'sessions-folder')

// Generation counter per conversation — used to cancel retries when a new message is sent
const streamGenerations = new Map<number, number>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readRetrySettings(db: Database.Database): { enabled: boolean; maxAttempts: number; initialDelayMs: number } {
  const rows = db
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

/** Increment the generation counter for a conversation, cancelling any pending retry */
export function invalidateRetry(conversationId: number): void {
  streamGenerations.set(conversationId, (streamGenerations.get(conversationId) ?? 0) + 1)
}

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

export function buildMessageHistory(db: Database.Database, conversationId: number, limit = 100): Array<{ role: 'user' | 'assistant'; content: string }> {
  const conv = db.prepare('SELECT cleared_at, compact_summary FROM conversations WHERE id = ?').get(conversationId) as { cleared_at: string | null; compact_summary: string | null } | undefined

  let query = 'SELECT role, content FROM messages WHERE conversation_id = ?'
  const params: (number | string)[] = [conversationId]

  if (conv?.cleared_at) {
    query += ' AND created_at > ?'
    params.push(conv.cleared_at)
  }

  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const rows = db.prepare(query).all(...params) as Pick<Message, 'role' | 'content'>[]

  const result = rows.reverse().map((row) => ({
    role: row.role,
    content: row.content,
  }))

  // Prepend compact summary as context so the AI retains prior conversation knowledge
  if (conv?.compact_summary) {
    result.unshift({ role: 'assistant', content: `[Previous conversation summary]\n${conv.compact_summary}` })
  }

  return result
}

function getFolderOverrides(db: Database.Database, folderId: number): Record<string, string> {
  const row = db
    .prepare('SELECT ai_overrides FROM folders WHERE id = ?')
    .get(folderId) as { ai_overrides: string | null } | undefined
  return row?.ai_overrides ? safeJsonParse<Record<string, string>>(row.ai_overrides, {}) : {}
}

export async function getSystemPrompt(db: Database.Database, conversationId: number, cwd: string): Promise<string> {
  const cwdDirective = `Your working directory is ${cwd}. Use absolute paths for all file operations.`

  const row = db
    .prepare('SELECT system_prompt, folder_id, ai_overrides FROM conversations WHERE id = ?')
    .get(conversationId) as { system_prompt: string | null; folder_id: number | null; ai_overrides: string | null } | undefined

  let prompt: string
  if (row?.system_prompt) {
    // Per-conversation system_prompt column takes absolute priority
    prompt = `${cwdDirective}\n\n${row.system_prompt}`
  } else {
    // Cascade: conversation overrides → folder overrides → global setting
    let cascadedPrompt: string | undefined

    // Check conversation ai_overrides
    if (row?.ai_overrides) {
      const convOv = safeJsonParse<Record<string, string>>(row.ai_overrides, {})
      if (convOv.ai_defaultSystemPrompt) cascadedPrompt = convOv.ai_defaultSystemPrompt
    }

    // Check folder ai_overrides (only if conversation didn't override)
    if (!cascadedPrompt && row?.folder_id) {
      const folderOv = getFolderOverrides(db, row.folder_id)
      if (folderOv.ai_defaultSystemPrompt) cascadedPrompt = folderOv.ai_defaultSystemPrompt
    }

    // Fall back to global default system prompt
    if (!cascadedPrompt) {
      const globalRow = db
        .prepare("SELECT value FROM settings WHERE key = 'ai_defaultSystemPrompt'")
        .get() as { value: string } | undefined
      cascadedPrompt = globalRow?.value || undefined
    }

    prompt = cascadedPrompt ? `${cwdDirective}\n\n${cascadedPrompt}` : cwdDirective
  }

  // ─── Agent personality & language injection ───────────────
  function cascadeAgentKey(key: string): string | undefined {
    if (row?.ai_overrides) {
      const convOv = safeJsonParse<Record<string, string>>(row.ai_overrides, {})
      if (convOv[key]) return convOv[key]
    }
    if (row?.folder_id) {
      const folderOv = getFolderOverrides(db, row.folder_id)
      if (folderOv[key]) return folderOv[key]
    }
    const globalRow = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return globalRow?.value || undefined
  }

  const agentPersonality = cascadeAgentKey('agent_personality')
  const agentLanguage = cascadeAgentKey('agent_language')

  if (agentPersonality) {
    prompt = `Personality: ${agentPersonality}\n\n${prompt}`
  }
  if (agentLanguage) {
    prompt = `Always respond in ${agentLanguage}.\n\n${prompt}`
  }

  // Append knowledge base collections if selected for this conversation
  // Read from cascaded ai_overrides (already merged: global -> folder -> conversation)
  const allOverrides = row?.ai_overrides
    ? safeJsonParse<Record<string, string>>(row.ai_overrides, {})
    : {}

  // Also check folder overrides for ai_knowledgeFolders cascade
  let knowledgeFoldersRaw = allOverrides['ai_knowledgeFolders']
  if (!knowledgeFoldersRaw && row?.folder_id) {
    knowledgeFoldersRaw = getFolderOverrides(db, row.folder_id)['ai_knowledgeFolders']
  }

  if (knowledgeFoldersRaw) {
    const knowledgesDir = getKnowledgesDir()
    const supportedExts = getSupportedExtensions()
    const selections = safeJsonParse<KnowledgeSelection[]>(knowledgeFoldersRaw, [])

    if (Array.isArray(selections) && selections.length > 0) {
      let kbContent = ''
      let totalSize = 0
      const writablePaths: string[] = []

      for (const sel of selections) {
        if (!sel.folder || typeof sel.folder !== 'string') continue
        // Prevent directory traversal
        if (sel.folder.includes('..') || sel.folder.includes('/') || sel.folder.includes('\\')) continue

        const collectionPath = join(knowledgesDir, sel.folder)
        // Validate: must resolve inside knowledgesDir
        const resolved = resolve(collectionPath)
        if (!resolved.startsWith(knowledgesDir)) continue

        const access = sel.access === 'readwrite' ? 'readwrite' : 'read'
        if (access === 'readwrite') {
          writablePaths.push(resolved)
        }

        // Recursively read supported files
        async function readCollectionFiles(dir: string): Promise<void> {
          let entries
          try {
            entries = await fsp.readdir(dir, { withFileTypes: true })
          } catch { return }

          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue
            const fullPath = join(dir, entry.name)
            if (entry.isDirectory()) {
              await readCollectionFiles(fullPath)
            } else if (supportedExts.has(extname(entry.name).toLowerCase())) {
              try {
                const content = await fsp.readFile(fullPath, 'utf-8')
                totalSize += content.length
                if (totalSize > 500_000) return
                const relPath = relative(collectionPath, fullPath)
                kbContent += `\n\n--- Knowledge [${access}]: ${sel.folder}/${relPath} ---\n${content}\n---`
              } catch {
                continue
              }
            }
          }
        }

        await readCollectionFiles(collectionPath)
        if (totalSize > 500_000) break
      }

      if (kbContent) {
        prompt += kbContent
      }
      if (writablePaths.length > 0) {
        prompt += '\n\nYou have write access to the following knowledge directories:\n' +
          writablePaths.map(p => `- ${p}`).join('\n')
      }
    }
  }

  // Scheduler directive: tell the AI about the built-in scheduler MCP tools
  const schedulerMcpAvailable = getSchedulerMcpConfig(conversationId) !== null
  if (schedulerMcpAvailable) {
    prompt += '\n\nYou have access to a built-in task scheduler via MCP tools (schedule_task, list_scheduled_tasks, cancel_scheduled_task). ' +
      'Use these tools for reminders, scheduled tasks, and recurring actions. ' +
      'Do NOT use cron, at, systemd timers, or other system schedulers — always use the built-in schedule_task tool. ' +
      'For one-time reminders, use the delay_minutes parameter. For recurring tasks, use interval_value + interval_unit.'
  }

  return prompt
}

import { CWD_CACHE_MAX, cwdCache, invalidateCwdCache } from './cwdCache'
export { invalidateCwdCache }

function getConversationCwd(db: Database.Database, conversationId: number): string {
  const cached = cwdCache.get(conversationId)
  if (cached) return cached

  // Evict oldest entries if cache exceeds limit
  if (cwdCache.size >= CWD_CACHE_MAX) {
    const firstKey = cwdCache.keys().next().value!
    cwdCache.delete(firstKey)
  }

  const row = db
    .prepare('SELECT cwd FROM conversations WHERE id = ?')
    .get(conversationId) as { cwd: string | null } | undefined

  let cwd: string
  if (row?.cwd) {
    // User-provided cwd: validate it's not a blocked system directory
    cwd = validatePathSafe(row.cwd)
  } else {
    // Default cwd: ensure it stays within SESSIONS_BASE
    cwd = join(SESSIONS_BASE, String(conversationId))
    cwd = validatePathSafe(cwd, SESSIONS_BASE)
  }

  mkdirSync(cwd, { recursive: true })
  cwdCache.set(conversationId, cwd)
  return cwd
}

function filterMcpServers(
  servers: AISettings['mcpServers'],
  disabledJson: string | undefined
): AISettings['mcpServers'] {
  if (!disabledJson) return servers
  const disabled = safeJsonParse<string[]>(disabledJson, [])
  if (!Array.isArray(disabled) || disabled.length === 0) return servers
  const disabledSet = new Set(disabled)
  const filtered: AISettings['mcpServers'] = {}
  for (const [name, config] of Object.entries(servers || {})) {
    if (!disabledSet.has(name)) filtered[name] = config
  }
  return filtered
}

export function getAISettings(db: Database.Database, conversationId: number): AISettings {
  const keys = ['ai_sdkBackend', 'ai_model', 'ai_maxTurns', 'ai_maxThinkingTokens', 'ai_maxBudgetUsd', 'ai_permissionMode', 'ai_tools', 'hooks_cwdRestriction', 'hooks_cwdWhitelist', 'settings_sharedAcrossBackends', 'ai_knowledgeFolders', 'ai_skills', 'ai_skillsEnabled', 'ai_disabledSkills', 'pi_disabledExtensions', 'pi_extensionsDir', 'ai_apiKey', 'ai_baseUrl', 'ai_customModel', 'tts_responseMode', 'tts_autoWordLimit', 'tts_summaryPrompt', 'tts_summaryModel']
  const rows = db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`)
    .all(...keys) as { key: string; value: string }[]

  const map: Record<string, string> = {}
  for (const row of rows) {
    map[row.key] = row.value
  }

  // Grab global-only values before cascade (these are not overridable per-conversation/folder)
  const globalApiKey = map['ai_apiKey'] || undefined
  const globalBaseUrl = map['ai_baseUrl'] || undefined
  const globalCustomModel = map['ai_customModel'] || undefined
  const globalModel = map['ai_model'] || undefined
  const globalPiExtensionsDir = map['pi_extensionsDir'] || undefined

  // Cascade: folder overrides → conversation overrides
  const convRow = db
    .prepare('SELECT folder_id, ai_overrides FROM conversations WHERE id = ?')
    .get(conversationId) as { folder_id: number | null; ai_overrides: string | null } | undefined

  if (convRow?.folder_id) {
    const folderOverrides = getFolderOverrides(db, convRow.folder_id)
    for (const [k, v] of Object.entries(folderOverrides)) {
      if (v !== undefined && v !== '') map[k] = v
    }
  }

  if (convRow?.ai_overrides) {
    const convOverrides = safeJsonParse<Record<string, string>>(convRow.ai_overrides, {})
    for (const [k, v] of Object.entries(convOverrides)) {
      if (v !== undefined && v !== '') map[k] = v
    }
  }

  // Parse CWD whitelist from cascaded settings
  const cwdWhitelist = safeJsonParse<CwdWhitelistEntry[]>(map['hooks_cwdWhitelist'] || '[]', [])

  // Parse tools setting
  const toolsValue = map['ai_tools'] || 'preset:claude_code'
  let tools: AISettings['tools']
  if (toolsValue === 'preset:claude_code') {
    tools = { type: 'preset', preset: 'claude_code' }
  } else {
    const parsed = safeJsonParse<string[] | null>(toolsValue, null)
    tools = parsed ?? { type: 'preset', preset: 'claude_code' }
  }

  // Build MCP servers config from enabled servers (supports stdio, http, sse)
  const mcpRows = db
    .prepare('SELECT name, type, command, args, env, url, headers FROM mcp_servers WHERE enabled = 1')
    .all() as { name: string; type: string | null; command: string; args: string; env: string; url: string | null; headers: string | null }[]

  const mcpServers: AISettings['mcpServers'] = {}
  for (const row of mcpRows) {
    try {
      const transport = row.type || 'stdio'
      if (transport === 'http' || transport === 'sse') {
        if (!row.url) continue
        const headers = safeJsonParse<Record<string, string>>(row.headers || '{}', {})
        mcpServers[row.name] = {
          type: transport,
          url: row.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        }
      } else {
        const args = safeJsonParse<string[]>(row.args, [])
        const env = safeJsonParse<Record<string, string>>(row.env, {})
        mcpServers[row.name] = { command: row.command, args, ...(Object.keys(env).length > 0 ? { env } : {}) }
      }
    } catch (err) {
      console.error(`[messages] Invalid MCP config for ${row.name}:`, err)
    }
  }

  // Merge knowledge folder selections into cwdWhitelist
  const kfRaw = map['ai_knowledgeFolders']
  const knowledgeFolders = kfRaw ? safeJsonParse<KnowledgeSelection[]>(kfRaw, []) : []
  if (Array.isArray(knowledgeFolders)) {
    const knowledgesDir = getKnowledgesDir()
    for (const sel of knowledgeFolders) {
      if (!sel.folder || !sel.folder.length) continue
      if (sel.folder.includes('..') || sel.folder.includes('/') || sel.folder.includes('\\')) continue
      const resolved = resolve(join(knowledgesDir, sel.folder))
      if (!resolved.startsWith(knowledgesDir)) continue
      const access = sel.access === 'readwrite' ? 'readwrite' : 'read'
      cwdWhitelist.push({ path: resolved, access })
    }
  }

  // Model priority: per-conversation/folder override > global custom model > global ai_model
  // 'custom' is a UI sentinel, not a real model — filter it out
  const cascadedModel = map['ai_model'] || undefined
  const modelWasOverridden = cascadedModel !== globalModel
  const rawModel = modelWasOverridden ? cascadedModel : (globalCustomModel || globalModel || undefined)
  const finalModel = rawModel === 'custom' ? undefined : rawModel

  // Inject scheduler MCP server (internal, per-conversation)
  const schedulerMcp = getSchedulerMcpConfig(conversationId)
  if (schedulerMcp) {
    mcpServers['agent_scheduler'] = schedulerMcp
  }

  return {
    sdkBackend: (map['ai_sdkBackend'] || 'claude-agent-sdk') as string,
    model: finalModel,
    maxTurns: map['ai_maxTurns'] ? Number(map['ai_maxTurns']) : undefined,
    maxThinkingTokens: map['ai_maxThinkingTokens'] ? Number(map['ai_maxThinkingTokens']) : undefined,
    maxBudgetUsd: map['ai_maxBudgetUsd'] ? Number(map['ai_maxBudgetUsd']) : undefined,
    cwd: getConversationCwd(db, conversationId),
    tools,
    permissionMode: map['ai_permissionMode'] || 'bypassPermissions',
    mcpServers: filterMcpServers(mcpServers, map['ai_mcpDisabled']),
    cwdRestrictionEnabled: (map['hooks_cwdRestriction'] ?? 'true') === 'true',
    cwdWhitelist,
    sharedHooks: (map['settings_sharedAcrossBackends'] ?? 'true') === 'true',
    skills: (map['ai_skills'] as 'off' | 'user' | 'project' | 'local') || 'off',
    skillsEnabled: (map['ai_skillsEnabled'] ?? 'true') === 'true',
    disabledSkills: safeJsonParse<string[]>(map['ai_disabledSkills'] || '[]', []),
    apiKey: globalApiKey,
    baseUrl: globalBaseUrl,
    ttsResponseMode: (map['tts_responseMode'] as 'off' | 'full' | 'summary' | 'auto') || undefined,
    ttsAutoWordLimit: map['tts_autoWordLimit'] ? Number(map['tts_autoWordLimit']) : undefined,
    ttsSummaryPrompt: map['tts_summaryPrompt'] || undefined,
    ttsSummaryModel: map['tts_summaryModel'] || undefined,
    piDisabledExtensions: safeJsonParse<string[]>(map['pi_disabledExtensions'] || '[]', []),
    piExtensionsDir: globalPiExtensionsDir,
  }
}

export function saveMessage(
  db: Database.Database,
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  attachments: Attachment[] = [],
  toolCalls?: ToolCall[]
): Message {
  const now = new Date().toISOString()
  const toolCallsJson = toolCalls?.length ? JSON.stringify(toolCalls) : null
  const result = db
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

function getConversationSdkSessionId(db: Database.Database, conversationId: number): string | null {
  const row = db.prepare('SELECT sdk_session_id FROM conversations WHERE id = ?').get(conversationId) as { sdk_session_id: string | null } | undefined
  return row?.sdk_session_id ?? null
}

function saveConversationSdkSessionId(db: Database.Database, conversationId: number, sessionId: string): void {
  db.prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?').run(sessionId, conversationId)
}

function clearConversationSdkSessionId(db: Database.Database, conversationId: number): void {
  db.prepare('UPDATE conversations SET sdk_session_id = NULL WHERE id = ?').run(conversationId)
}

function updateConversationTimestamp(db: Database.Database, conversationId: number): void {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    conversationId
  )
}

function buildLastUserMessage(
  db: Database.Database,
  conversationId: number
): Array<{ role: Message['role']; content: string }> {
  const row = db.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(conversationId) as Pick<Message, 'role' | 'content'> | undefined
  return row ? [{ role: row.role, content: row.content }] : []
}

async function streamAndSave(
  db: Database.Database,
  conversationId: number
): Promise<Message | null> {
  stopTts() // Stop any active TTS before new stream

  // Increment generation counter — any pending retry for this conversation is now stale
  const generation = (streamGenerations.get(conversationId) ?? 0) + 1
  streamGenerations.set(conversationId, generation)

  const sdkSessionId = getConversationSdkSessionId(db, conversationId)
  // Session active : le SDK détient tout le contexte — envoyer uniquement le nouveau prompt.
  // Pas de session (fork, regenerate, clear, etc.) : envoyer l'historique complet comme fallback.
  const messages = sdkSessionId
    ? buildLastUserMessage(db, conversationId)
    : buildMessageHistory(db, conversationId)

  const aiSettings = getAISettings(db, conversationId)
  const systemPrompt = await getSystemPrompt(db, conversationId, aiSettings.cwd!)

  // Run UserPromptSubmit hooks manually — the SDK subprocess doesn't yield
  // hook_response for this event through the async iterator (ONCE, not per retry)
  // Skip hooks for non-Claude backends when sharedHooks is disabled
  const isClaudeBackend = aiSettings.sdkBackend !== 'pi'
  const runHooks = isClaudeBackend || aiSettings.sharedHooks !== false
  let hookSystemContents: string[] = []
  const lastUserMsg = messages[messages.length - 1]
  if (runHooks && lastUserMsg?.role === 'user') {
    const hookMessages = await runUserPromptSubmitHooks(
      lastUserMsg.content,
      aiSettings.cwd || process.cwd(),
      aiSettings.permissionMode || 'bypassPermissions'
    )
    const convExtra = { conversationId }
    for (const msg of hookMessages) {
      sendChunk('system_message', msg.content, {
        hookEvent: msg.hookEvent,
        ...convExtra,
      })
      hookSystemContents.push(msg.content)
    }
  }

  const retrySettings = readRetrySettings(db)
  const maxAttempts = retrySettings.enabled ? retrySettings.maxAttempts : 1
  const convExtra = { conversationId }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check if generation has changed (new message sent or stop clicked)
    if (streamGenerations.get(conversationId) !== generation) return null

    // On retry: clear SDK session (may be corrupted) and rebuild full history
    const attemptSessionId = attempt === 1 ? sdkSessionId : null
    const attemptMessages = attempt === 1
      ? messages
      : buildMessageHistory(db, conversationId)

    try {
      const { content: responseContent, toolCalls, aborted, sessionId: newSessionId, error } = await streamMessage(
        attemptMessages, systemPrompt, aiSettings, conversationId, attemptSessionId
      )

      if (aborted) return null

      if (!error && responseContent) {
        // Save the SDK session ID for future resume
        if (newSessionId) {
          saveConversationSdkSessionId(db, conversationId, newSessionId)
        }
        const exists = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(conversationId)
        if (!exists) return null
        // Prepend hook system messages with a detectable tag so the renderer
        // can extract them and apply accent styling (same as StreamingIndicator)
        const finalContent = hookSystemContents.length > 0
          ? hookSystemContents.map(c => `<hook-system-message>${c}</hook-system-message>`).join('\n') + '\n\n' + responseContent
          : responseContent
        const assistantMsg = saveMessage(db, conversationId, 'assistant', finalContent, [], toolCalls)
        updateConversationTimestamp(db, conversationId)
        notifyConversationUpdated(conversationId)
        // Fire-and-forget: TTS for AI response
        speakResponse(responseContent, db, conversationId, aiSettings)
          .catch(err => console.error('[tts] Response TTS error:', err))
        return assistantMsg
      }

      // No error but no content — empty response (e.g. stream ended without output), no retry
      if (!error) return null

      // Error path: retry with backoff or emit final error
      // Clear SDK session on error — it may be corrupted
      if (attemptSessionId) {
        clearConversationSdkSessionId(db, conversationId)
      }
      invalidateSession(conversationId)

      if (attempt < maxAttempts) {
        const delay = retrySettings.initialDelayMs * Math.pow(2, attempt - 1)
        console.warn(`[messages] Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms:`, error)
        sendChunk('retry', `Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${maxAttempts})...`, {
          ...convExtra,
          retryAttempt: attempt + 1,
          retryMaxAttempts: maxAttempts,
          retryDelayMs: delay,
        })
        await sleep(delay)
        // Re-check generation after sleep
        if (streamGenerations.get(conversationId) !== generation) return null
        continue
      }

      // Last attempt failed — emit error to renderer
      sendChunk('error', error, convExtra)
      return null
    } catch (err) {
      // If resume failed (corrupted/deleted session) on first attempt, retry without session
      if (attempt === 1 && sdkSessionId) {
        console.warn('[messages] SDK session resume failed, retrying with full history:', err instanceof Error ? err.message : String(err))
        clearConversationSdkSessionId(db, conversationId)
        invalidateSession(conversationId)
        // Continue to next attempt with cleared session
        continue
      }
      console.error('[messages] Stream error:', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  return null
}

async function generateConversationTitle(
  db: Database.Database,
  conversationId: number,
  userContent: string,
  assistantContent: string
): Promise<void> {
  const userSnippet = userContent.slice(0, 200)
  const assistantSnippet = assistantContent.slice(0, 200)

  // Inject API key env vars for title generation (same provider as main streaming)
  const apiKeyRow = db.prepare("SELECT key, value FROM settings WHERE key IN ('ai_apiKey', 'ai_baseUrl')").all() as { key: string; value: string }[]
  const apiMap: Record<string, string> = {}
  for (const r of apiKeyRow) apiMap[r.key] = r.value
  const restoreEnv = injectApiKeyEnv(apiMap['ai_apiKey'] || undefined, apiMap['ai_baseUrl'] || undefined)

  try {
  const sdk = await loadAgentSDK()

  let title = ''
  const agentQuery = sdk.query({
    prompt: `Generate a very short title (3-6 words) for this conversation. Reply with ONLY the title — no quotes, no explanation.\nUser: ${userSnippet}\nAssistant: ${assistantSnippet}`,
    options: {
      model: HAIKU_MODEL,
      maxTurns: 1,
      allowDangerouslySkipPermissions: true,
      permissionMode: 'bypassPermissions',
      tools: [],
      persistSession: false,
    },
  })

  for await (const message of agentQuery) {
    const msg = message as { type: string; subtype?: string; result?: string; message?: { content?: Array<{ type: string; text?: string }> } }
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          title = block.text.trim().replace(/^["']|["']$/g, '').slice(0, 80)
        }
      }
    }
    if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string' && msg.result.trim()) {
      title = msg.result.trim().replace(/^["']|["']$/g, '').slice(0, 80)
    }
  }

  if (!title) {
    console.warn('[messages] Auto-title: empty title generated for conversation', conversationId)
    return
  }

  console.log('[messages] Auto-title:', title, 'for conversation', conversationId)
  db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId)

  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('conversations:titleUpdated', { id: conversationId, title })
  }
  broadcast('conversations:titleUpdated', { id: conversationId, title })
  } finally {
    restoreEnv?.()
  }
}

async function compactConversation(
  db: Database.Database,
  conversationId: number
): Promise<{ summary: string; clearedAt: string }> {
  const history = buildMessageHistory(db, conversationId)
  if (history.length === 0) {
    const clearedAt = new Date().toISOString()
    db.prepare('UPDATE conversations SET cleared_at = ?, compact_summary = NULL, updated_at = ? WHERE id = ?')
      .run(clearedAt, clearedAt, conversationId)
    return { summary: '', clearedAt }
  }

  // Build conversation text for summarization
  const conversationText = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  // Inject API key env vars (same pattern as generateConversationTitle)
  const apiKeyRow = db.prepare("SELECT key, value FROM settings WHERE key IN ('ai_apiKey', 'ai_baseUrl')").all() as { key: string; value: string }[]
  const apiMap: Record<string, string> = {}
  for (const r of apiKeyRow) apiMap[r.key] = r.value
  const restoreEnv = injectApiKeyEnv(apiMap['ai_apiKey'] || undefined, apiMap['ai_baseUrl'] || undefined)

  try {
    const sdk = await loadAgentSDK()

    let summary = ''
    const agentQuery = sdk.query({
      prompt: `Summarize the following conversation into a concise context summary that preserves all key information, decisions, code changes, file paths, and important details. The summary will replace the full conversation history, so it must capture everything needed to continue the conversation seamlessly. Write the summary as a factual recap, not as a conversation. Do NOT wrap it in quotes or add a preamble.\n\n${conversationText}`,
      options: {
        model: HAIKU_MODEL,
        maxTurns: 1,
        allowDangerouslySkipPermissions: true,
        permissionMode: 'bypassPermissions',
        tools: [],
        persistSession: false,
      },
    })

    for await (const message of agentQuery) {
      const msg = message as { type: string; subtype?: string; result?: string; message?: { content?: Array<{ type: string; text?: string }> } }
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            summary = block.text.trim()
          }
        }
      }
      if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string' && msg.result.trim()) {
        summary = msg.result.trim()
      }
    }

    const clearedAt = new Date().toISOString()
    db.prepare('UPDATE conversations SET cleared_at = ?, compact_summary = ?, sdk_session_id = NULL, updated_at = ? WHERE id = ?')
      .run(clearedAt, summary || null, clearedAt, conversationId)
    invalidateSession(conversationId)

    return { summary, clearedAt }
  } finally {
    restoreEnv?.()
  }
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle(
    'messages:send',
    async (_event, conversationId: number, content: string, attachments?: Attachment[]) => {
      // Validate inputs
      validatePositiveInt(conversationId, 'conversationId')
      validateString(content, 'content', 10_000_000) // 10MB max

      // Copy attachments to session folder and augment message content
      const cwd = getConversationCwd(db, conversationId)
      let finalContent = content
      let savedAttachments = attachments
      if (attachments?.length) {
        const { copied, contentSuffix } = await copyAttachmentsToSession(cwd, attachments)
        savedAttachments = copied
        finalContent = content + contentSuffix
      }

      // Save user message (content includes attachment links)
      saveMessage(db, conversationId, 'user', finalContent, savedAttachments)
      updateConversationTimestamp(db, conversationId)

      // Stream response and save
      const assistantMsg = await streamAndSave(db, conversationId)

      // Auto-title on first assistant response (fire-and-forget)
      // Skip for Quick Chat conversation — its title stays fixed
      if (assistantMsg) {
        const quickChatRow = db.prepare("SELECT value FROM settings WHERE key = 'quickChat_conversationId'").get() as { value: string } | undefined
        const isQuickChat = quickChatRow?.value === String(conversationId)
        if (!isQuickChat) {
          const assistantCount = db.prepare(
            "SELECT COUNT(*) as c FROM messages WHERE conversation_id = ? AND role = 'assistant'"
          ).get(conversationId) as { c: number }
          if (assistantCount.c === 1) {
            generateConversationTitle(db, conversationId, content, assistantMsg.content)
              .catch(err => console.error('[messages] Auto-title error:', err))
          }
        }
      }

      return assistantMsg
    }
  )

  ipcMain.handle('messages:compact', async (_event, conversationId: number) => {
    validatePositiveInt(conversationId, 'conversationId')
    return compactConversation(db, conversationId)
  })

  ipcMain.handle('messages:stop', async (_event, conversationId?: number) => {
    if (conversationId != null) {
      validatePositiveInt(conversationId, 'conversationId')
      invalidateRetry(conversationId)
    }
    abortStream(conversationId)
  })

  ipcMain.handle(
    'messages:respondToApproval',
    async (_event, requestId: string, response: ToolApprovalResponse | AskUserResponse) => {
      respondToApproval(requestId, response)
    }
  )

  ipcMain.handle('messages:regenerate', async (_event, conversationId: number) => {
    // Validate inputs
    validatePositiveInt(conversationId, 'conversationId')

    // Find and delete the last assistant message
    const lastAssistant = db
      .prepare(
        `SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(conversationId) as { id: number } | undefined

    if (lastAssistant) {
      db.prepare('DELETE FROM messages WHERE id = ?').run(lastAssistant.id)
    }

    // Clear SDK session — history has diverged from the SDK's internal state
    clearConversationSdkSessionId(db, conversationId)
    invalidateSession(conversationId)

    // Bump updated_at so conversation sorts to top immediately (matches messages:send behavior)
    updateConversationTimestamp(db, conversationId)

    // Re-send: build history (now without last assistant), stream new response
    return streamAndSave(db, conversationId)
  })

  ipcMain.handle('messages:edit', async (_event, messageId: number, content: string) => {
    // Validate inputs
    validatePositiveInt(messageId, 'messageId')
    validateString(content, 'content', 10_000_000) // 10MB max

    // Get message info
    const msg = db
      .prepare('SELECT id, conversation_id, created_at FROM messages WHERE id = ?')
      .get(messageId) as { id: number; conversation_id: number; created_at: string } | undefined

    if (!msg) throw new Error('Message not found')

    // Atomically update message content, delete all subsequent messages, and clear SDK session
    db.transaction(() => {
      db.prepare('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?').run(
        content,
        new Date().toISOString(),
        messageId
      )
      db.prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND id > ?'
      ).run(msg.conversation_id, msg.id)
      db.prepare('UPDATE conversations SET sdk_session_id = NULL WHERE id = ?').run(msg.conversation_id)
    })()
    invalidateSession(msg.conversation_id)

    // Bump updated_at so conversation sorts to top immediately (matches messages:send behavior)
    updateConversationTimestamp(db, msg.conversation_id)

    // Re-send with updated history
    return streamAndSave(db, msg.conversation_id)
  })

  ipcMain.handle('conversations:generateTitle', async (_event, conversationId: number) => {
    validatePositiveInt(conversationId, 'conversationId')

    const firstUser = db.prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1"
    ).get(conversationId) as { content: string } | undefined

    const firstAssistant = db.prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at ASC LIMIT 1"
    ).get(conversationId) as { content: string } | undefined

    if (!firstUser) return

    await generateConversationTitle(
      db,
      conversationId,
      firstUser.content,
      firstAssistant?.content || ''
    )
  })
}
