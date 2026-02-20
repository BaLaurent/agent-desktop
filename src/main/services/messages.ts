import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { promises as fsp } from 'fs'
import { join, basename, extname, resolve, relative } from 'path'
import { app } from 'electron'
import { streamMessage, abortStream, respondToApproval, injectApiKeyEnv } from './streaming'
import { loadAgentSDK } from './anthropic'
import { getMainWindow } from '../index'
import type { AISettings } from './streaming'
import type { Message, Attachment, ToolCall, ToolApprovalResponse, AskUserResponse, KnowledgeSelection } from '../../shared/types'
import { validateString, validatePositiveInt, validatePathSafe } from '../utils/validate'
import { getSchedulerMcpConfig } from './schedulerBridge'
import { speakResponse, stop as stopTts } from './tts'
import { safeJsonParse } from '../utils/json'
import { getKnowledgesDir, getSupportedExtensions } from './knowledge'
import { DEFAULT_MODEL, HAIKU_MODEL } from '../../shared/constants'

const SESSIONS_BASE = join(app.getPath('home'), '.agent-desktop', 'sessions-folder')

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
  const conv = db.prepare('SELECT cleared_at FROM conversations WHERE id = ?').get(conversationId) as { cleared_at: string | null } | undefined

  let query = 'SELECT role, content FROM messages WHERE conversation_id = ?'
  const params: (number | string)[] = [conversationId]

  if (conv?.cleared_at) {
    query += ' AND created_at > ?'
    params.push(conv.cleared_at)
  }

  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const rows = db.prepare(query).all(...params) as Pick<Message, 'role' | 'content'>[]

  return rows.reverse().map((row) => ({
    role: row.role,
    content: row.content,
  }))
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
  const keys = ['ai_model', 'ai_maxTurns', 'ai_maxThinkingTokens', 'ai_maxBudgetUsd', 'ai_permissionMode', 'ai_tools', 'hooks_cwdRestriction', 'ai_knowledgeFolders', 'ai_skills', 'ai_skillsEnabled', 'ai_disabledSkills', 'ai_apiKey', 'ai_baseUrl', 'ai_customModel', 'tts_responseMode', 'tts_autoWordLimit', 'tts_summaryPrompt']
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

  // Compute writable knowledge paths from cascaded overrides
  const kfRaw = map['ai_knowledgeFolders']
  const knowledgeFolders = kfRaw ? safeJsonParse<KnowledgeSelection[]>(kfRaw, []) : []
  const writableKnowledgePaths: string[] = []
  if (Array.isArray(knowledgeFolders)) {
    const knowledgesDir = getKnowledgesDir()
    for (const sel of knowledgeFolders) {
      if (sel.access === 'readwrite' && sel.folder && !sel.folder.includes('..') && !sel.folder.includes('/') && !sel.folder.includes('\\')) {
        const resolved = resolve(join(knowledgesDir, sel.folder))
        if (resolved.startsWith(knowledgesDir)) {
          writableKnowledgePaths.push(resolved)
        }
      }
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
    model: finalModel,
    maxTurns: map['ai_maxTurns'] ? Number(map['ai_maxTurns']) : undefined,
    maxThinkingTokens: map['ai_maxThinkingTokens'] ? Number(map['ai_maxThinkingTokens']) : undefined,
    maxBudgetUsd: map['ai_maxBudgetUsd'] ? Number(map['ai_maxBudgetUsd']) : undefined,
    cwd: getConversationCwd(db, conversationId),
    tools,
    permissionMode: map['ai_permissionMode'] || 'bypassPermissions',
    mcpServers: filterMcpServers(mcpServers, map['ai_mcpDisabled']),
    cwdRestrictionEnabled: (map['hooks_cwdRestriction'] ?? 'true') === 'true',
    writableKnowledgePaths,
    skills: (map['ai_skills'] as 'off' | 'user' | 'project' | 'local') || 'off',
    skillsEnabled: (map['ai_skillsEnabled'] ?? 'true') === 'true',
    disabledSkills: safeJsonParse<string[]>(map['ai_disabledSkills'] || '[]', []),
    apiKey: globalApiKey,
    baseUrl: globalBaseUrl,
    ttsResponseMode: (map['tts_responseMode'] as 'off' | 'full' | 'summary' | 'auto') || undefined,
    ttsAutoWordLimit: map['tts_autoWordLimit'] ? Number(map['tts_autoWordLimit']) : undefined,
    ttsSummaryPrompt: map['tts_summaryPrompt'] || undefined,
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

function updateConversationTimestamp(db: Database.Database, conversationId: number): void {
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    conversationId
  )
}

async function streamAndSave(
  db: Database.Database,
  conversationId: number
): Promise<Message | null> {
  stopTts() // Stop any active TTS before new stream
  const history = buildMessageHistory(db, conversationId)
  const aiSettings = getAISettings(db, conversationId)
  const systemPrompt = await getSystemPrompt(db, conversationId, aiSettings.cwd!)
  try {
    const { content: responseContent, toolCalls } = await streamMessage(
      history, systemPrompt, aiSettings, conversationId
    )
    if (responseContent) {
      const exists = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(conversationId)
      if (!exists) return null
      const assistantMsg = saveMessage(db, conversationId, 'assistant', responseContent, [], toolCalls)
      updateConversationTimestamp(db, conversationId)
      // Fire-and-forget: TTS for AI response
      speakResponse(responseContent, db, conversationId, aiSettings)
        .catch(err => console.error('[tts] Response TTS error:', err))
      return assistantMsg
    }
  } catch (err) {
    console.error('[messages] Stream error:', err instanceof Error ? err.message : String(err))
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

  ipcMain.handle('messages:stop', async (_event, conversationId?: number) => {
    if (conversationId != null) validatePositiveInt(conversationId, 'conversationId')
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

    // Atomically update message content and delete all subsequent messages
    db.transaction(() => {
      db.prepare('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?').run(
        content,
        new Date().toISOString(),
        messageId
      )
      db.prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND id > ?'
      ).run(msg.conversation_id, msg.id)
    })()

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
