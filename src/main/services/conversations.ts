import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { validateString, validatePositiveInt } from '../utils/validate'
import { DEFAULT_MODEL } from '../../shared/constants'
import { invalidateCwdCache } from './cwdCache'

const SEARCH_RESULTS_LIMIT = 50

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('conversations:list', () => {
    return db
      .prepare(
        `SELECT * FROM conversations ORDER BY updated_at DESC`
      )
      .all()
  })

  ipcMain.handle('conversations:get', (_e, id: number) => {
    validatePositiveInt(id, 'conversationId')
    const conversation = db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id)
    if (!conversation) return null
    const messages = db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
      )
      .all(id)
    return { ...conversation, messages }
  })

  ipcMain.handle('conversations:create', (_e, title?: string) => {
    if (title !== undefined) validateString(title, 'title', 500)
    const modelRow = db
      .prepare("SELECT value FROM settings WHERE key = 'ai_model'")
      .get() as { value: string } | undefined
    const model = modelRow?.value || DEFAULT_MODEL

    const result = db
      .prepare(
        `INSERT INTO conversations (title, model, updated_at)
         VALUES (?, ?, datetime('now'))`
      )
      .run(title || 'New Conversation', model)
    return db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(result.lastInsertRowid)
  })

  ipcMain.handle(
    'conversations:update',
    (_e, id: number, data: Record<string, unknown>) => {
      validatePositiveInt(id, 'conversationId')
      if (data.title !== undefined) validateString(data.title as string, 'title', 500)
      if (data.model !== undefined) validateString(data.model as string, 'model', 200)
      if (data.system_prompt !== undefined && data.system_prompt !== null) validateString(data.system_prompt as string, 'system_prompt', 100_000)
      if (data.cwd !== undefined && data.cwd !== null) validateString(data.cwd as string, 'cwd', 1000)
      if (data.ai_overrides !== undefined && data.ai_overrides !== null) validateString(data.ai_overrides as string, 'ai_overrides', 10_000)
      if (data.cleared_at !== undefined && data.cleared_at !== null) validateString(data.cleared_at as string, 'cleared_at', 50)
      if (data.folder_id !== undefined && data.folder_id !== null) validatePositiveInt(data.folder_id as number, 'folderId')
      const allowed = ['title', 'folder_id', 'position', 'model', 'system_prompt', 'kb_enabled', 'cwd', 'ai_overrides', 'cleared_at']
      const fields: string[] = []
      const values: unknown[] = []
      for (const key of allowed) {
        if (key in data) {
          fields.push(`${key} = ?`)
          values.push(data[key])
        }
      }
      if (fields.length === 0) return
      fields.push("updated_at = datetime('now')")
      values.push(id)
      db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(
        ...values
      )
      // Invalidate CWD cache when cwd changes so next stream picks up the new value
      if ('cwd' in data) invalidateCwdCache(id)
    }
  )

  ipcMain.handle('conversations:delete', (_e, id: number) => {
    validatePositiveInt(id, 'conversationId')
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  })

  ipcMain.handle(
    'conversations:export',
    (_e, id: number, format: 'markdown' | 'json') => {
      validatePositiveInt(id, 'conversationId')
      validateString(format, 'format', 20)
      const conversation = db
        .prepare('SELECT * FROM conversations WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined
      if (!conversation) return ''
      const messages = db
        .prepare(
          'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
        )
        .all(id) as Array<Record<string, unknown>>

      if (format === 'markdown') {
        let md = `# ${conversation.title}\n\n`
        for (const msg of messages) {
          const role = msg.role === 'user' ? 'You' : 'Assistant'
          md += `## ${role}\n\n${msg.content}\n\n`
        }
        return md
      }

      // json
      return JSON.stringify({ conversation, messages }, null, 2)
    }
  )

  ipcMain.handle('conversations:import', (_e, data: string) => {
    validateString(data, 'data', 10_000_000)

    let parsed: any
    try { parsed = JSON.parse(data) }
    catch { throw new Error('Invalid JSON format') }

    const { conversation, messages } = parsed

    // Validate fields
    const title = typeof conversation?.title === 'string' ? conversation.title.slice(0, 500) : 'Imported Conversation'
    const model = typeof conversation?.model === 'string' ? conversation.model.slice(0, 200) : DEFAULT_MODEL
    const systemPrompt = (typeof conversation?.system_prompt === 'string') ? conversation.system_prompt : null
    const kbEnabled = conversation?.kb_enabled === 1 ? 1 : 0

    const insertConv = db.prepare(
      `INSERT INTO conversations (title, model, system_prompt, kb_enabled, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
    const insertMsg = db.prepare(
      `INSERT INTO messages (conversation_id, role, content, attachments, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )

    // Wrap in transaction for atomicity
    const importConv = db.transaction(() => {
      const result = insertConv.run(title, model, systemPrompt, kbEnabled)
      const newId = result.lastInsertRowid

      if (Array.isArray(messages)) {
        for (const msg of messages) {
          // Skip invalid roles
          if (msg.role !== 'user' && msg.role !== 'assistant') continue
          const content = typeof msg.content === 'string' ? msg.content : ''
          const attachments = typeof msg.attachments === 'string' ? msg.attachments : '[]'
          // Normalize created_at to ISO format
          let createdAt: string
          try {
            createdAt = new Date(msg.created_at).toISOString()
          } catch {
            createdAt = new Date().toISOString()
          }
          insertMsg.run(newId, msg.role, content, attachments, createdAt)
        }
      }
      return newId
    })

    const newId = importConv()
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(newId)
  })

  ipcMain.handle('conversations:search', (_e, query: string) => {
    validateString(query, 'query', 500)
    const pattern = `%${query}%`
    return db
      .prepare(
        `SELECT DISTINCT c.*
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.title LIKE ? OR m.content LIKE ?
         ORDER BY c.updated_at DESC
         LIMIT ${SEARCH_RESULTS_LIMIT}`
      )
      .all(pattern, pattern)
  })
}
