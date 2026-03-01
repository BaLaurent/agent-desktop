import { vi } from 'vitest'

// Mock sessionManager to avoid transitive import of streaming → knowledge → app.getPath
vi.mock('./sessionManager', () => ({
  invalidateSession: vi.fn(),
}))

// Mock scheduler to avoid transitive import of streaming → knowledge → app.getPath
vi.mock('./scheduler', () => ({
  reassignOrphanedTasks: vi.fn(),
}))

import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './conversations'
import { registerHandlers as registerFolderHandlers } from './folders'
import type Database from 'better-sqlite3'

describe('Conversations Service', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(async () => {
    db = await createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
    registerFolderHandlers(ipc as any, db)
  })

  afterEach(() => {
    db.close()
  })

  it('create returns conversation object with id, title, timestamps', async () => {
    const conv = await ipc.invoke('conversations:create', 'Test Chat') as any
    expect(conv).toBeDefined()
    expect(conv.id).toBeGreaterThan(0)
    expect(conv.title).toBe('Test Chat')
    expect(conv.created_at).toBeDefined()
    expect(conv.updated_at).toBeDefined()
  })

  it('create defaults to "New Conversation" when no title given', async () => {
    const conv = await ipc.invoke('conversations:create') as any
    expect(conv.title).toBe('New Conversation')
  })

  it('list returns conversations sorted by updated_at DESC', async () => {
    await ipc.invoke('conversations:create', 'First')
    await ipc.invoke('conversations:create', 'Second')
    const list = await ipc.invoke('conversations:list') as any[]
    expect(list.length).toBe(2)
    // Most recently created/updated first
    expect(list[0].title).toBe('Second')
    expect(list[1].title).toBe('First')
  })

  it('get returns conversation with messages array', async () => {
    const conv = await ipc.invoke('conversations:create', 'With Messages') as any
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conv.id, 'user', 'hello')
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conv.id, 'assistant', 'hi there')

    const result = await ipc.invoke('conversations:get', conv.id) as any
    expect(result.title).toBe('With Messages')
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0].role).toBe('user')
    expect(result.messages[1].role).toBe('assistant')
  })

  it('get returns null for nonexistent conversation', async () => {
    const result = await ipc.invoke('conversations:get', 99999)
    expect(result).toBeNull()
  })

  it('create assigns default folder when no folderId provided', async () => {
    const conv = await ipc.invoke('conversations:create', 'Auto Folder') as any
    const defaultFolder = db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as any
    expect(conv.folder_id).toBe(defaultFolder.id)
  })

  it('create assigns specified folderId when provided', async () => {
    const folder = await ipc.invoke('folders:create', 'Custom') as any
    const conv = await ipc.invoke('conversations:create', 'In Custom', folder.id) as any
    expect(conv.folder_id).toBe(folder.id)
  })

  it('update title changes title', async () => {
    const conv = await ipc.invoke('conversations:create', 'Old Title') as any
    await ipc.invoke('conversations:update', conv.id, { title: 'New Title' })
    const updated = await ipc.invoke('conversations:get', conv.id) as any
    expect(updated.title).toBe('New Title')
  })

  it('update cwd sets cwd field', async () => {
    const conv = await ipc.invoke('conversations:create', 'CWD Test') as any
    await ipc.invoke('conversations:update', conv.id, { cwd: '/tmp/test-dir' })
    const updated = await ipc.invoke('conversations:get', conv.id) as any
    expect(updated.cwd).toBe('/tmp/test-dir')
  })

  it('update cleared_at sets timestamp for context boundary', async () => {
    const conv = await ipc.invoke('conversations:create', 'Clear Test') as any
    const ts = '2024-06-15T12:00:00.000Z'
    await ipc.invoke('conversations:update', conv.id, { cleared_at: ts })
    const updated = await ipc.invoke('conversations:get', conv.id) as any
    expect(updated.cleared_at).toBe(ts)
  })

  it('update cleared_at auto-clears sdk_session_id', async () => {
    const conv = await ipc.invoke('conversations:create', 'Session Clear') as any
    // Manually set a session ID
    db.prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?').run('session-123', conv.id)
    // Setting cleared_at should also clear the SDK session
    await ipc.invoke('conversations:update', conv.id, { cleared_at: '2024-06-15T12:00:00.000Z' })
    const updated = await ipc.invoke('conversations:get', conv.id) as any
    expect(updated.cleared_at).toBe('2024-06-15T12:00:00.000Z')
    expect(updated.sdk_session_id).toBeNull()
  })

  it('update sdk_session_id directly', async () => {
    const conv = await ipc.invoke('conversations:create', 'SDK Session') as any
    await ipc.invoke('conversations:update', conv.id, { sdk_session_id: 'my-session-abc' })
    const updated = await ipc.invoke('conversations:get', conv.id) as any
    expect(updated.sdk_session_id).toBe('my-session-abc')
  })

  it('update cleared_at to null clears the boundary', async () => {
    const conv = await ipc.invoke('conversations:create', 'Clear Reset') as any
    await ipc.invoke('conversations:update', conv.id, { cleared_at: '2024-01-01T00:00:00Z' })
    await ipc.invoke('conversations:update', conv.id, { cleared_at: null })
    const updated = await ipc.invoke('conversations:get', conv.id) as any
    expect(updated.cleared_at).toBeNull()
  })

  it('delete cascades (messages are deleted via FK CASCADE)', async () => {
    const conv = await ipc.invoke('conversations:create', 'To Delete') as any
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conv.id, 'user', 'bye')

    await ipc.invoke('conversations:delete', conv.id)

    const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(conv.id)
    expect(msgs).toHaveLength(0)
    const deleted = await ipc.invoke('conversations:get', conv.id)
    expect(deleted).toBeNull()
  })

  it('export markdown format includes ## role headers', async () => {
    const conv = await ipc.invoke('conversations:create', 'Export Test') as any
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conv.id, 'user', 'Question')
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conv.id, 'assistant', 'Answer')

    const md = await ipc.invoke('conversations:export', conv.id, 'markdown') as string
    expect(md).toContain('# Export Test')
    expect(md).toContain('## You')
    expect(md).toContain('## Assistant')
    expect(md).toContain('Question')
    expect(md).toContain('Answer')
  })

  it('export json format is valid JSON with conversation + messages', async () => {
    const conv = await ipc.invoke('conversations:create', 'JSON Export') as any
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conv.id, 'user', 'data')

    const jsonStr = await ipc.invoke('conversations:export', conv.id, 'json') as string
    const parsed = JSON.parse(jsonStr)
    expect(parsed.conversation).toBeDefined()
    expect(parsed.conversation.title).toBe('JSON Export')
    expect(parsed.messages).toHaveLength(1)
  })

  it('import creates new conversation with messages', async () => {
    const data = JSON.stringify({
      conversation: { title: 'Imported Chat', model: 'claude-sonnet-4-6-20250514' },
      messages: [
        { role: 'user', content: 'imported question', created_at: '2025-01-01T00:00:00Z' },
        { role: 'assistant', content: 'imported answer', created_at: '2025-01-01T00:00:01Z' },
      ],
    })

    const imported = await ipc.invoke('conversations:import', data) as any
    expect(imported.title).toBe('Imported Chat')
    expect(imported.id).toBeGreaterThan(0)

    const full = await ipc.invoke('conversations:get', imported.id) as any
    expect(full.messages).toHaveLength(2)
  })

  it('import assigns default folder to imported conversation', async () => {
    const data = JSON.stringify({
      conversation: { title: 'Imported' },
      messages: [{ role: 'user', content: 'hello', created_at: '2025-01-01T00:00:00Z' }],
    })
    const conv = await ipc.invoke('conversations:import', data) as any
    const defaultFolder = db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as any
    expect(conv.folder_id).toBe(defaultFolder.id)
  })

  it('search by title finds matching conversations', async () => {
    await ipc.invoke('conversations:create', 'Alpha Project')
    await ipc.invoke('conversations:create', 'Beta Project')
    await ipc.invoke('conversations:create', 'Gamma Work')

    const results = await ipc.invoke('conversations:search', 'Project') as any[]
    expect(results.length).toBe(2)
    expect(results.every((c: any) => c.title.includes('Project'))).toBe(true)
  })

  it('search by message content finds matching conversations', async () => {
    const conv = await ipc.invoke('conversations:create', 'Searchable') as any
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(conv.id, 'user', 'unique_search_term_xyz')

    const results = await ipc.invoke('conversations:search', 'unique_search_term_xyz') as any[]
    expect(results.length).toBe(1)
    expect(results[0].id).toBe(conv.id)
  })

  it('search with no match returns empty array', async () => {
    await ipc.invoke('conversations:create', 'Nothing Special')
    const results = await ipc.invoke('conversations:search', 'zzz_nonexistent_zzz') as any[]
    expect(results).toHaveLength(0)
  })

  describe('deleteMany', () => {
    it('deletes multiple conversations in a single transaction', async () => {
      const c1 = await ipc.invoke('conversations:create', 'One') as any
      const c2 = await ipc.invoke('conversations:create', 'Two') as any
      const c3 = await ipc.invoke('conversations:create', 'Three') as any

      await ipc.invoke('conversations:deleteMany', [c1.id, c3.id])

      const list = await ipc.invoke('conversations:list') as any[]
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe(c2.id)
    })

    it('cascades message deletion', async () => {
      const c = await ipc.invoke('conversations:create', 'WithMsg') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(c.id, 'user', 'hi')

      await ipc.invoke('conversations:deleteMany', [c.id])

      expect(db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(c.id)).toHaveLength(0)
    })

    it('is a no-op for empty array', async () => {
      await ipc.invoke('conversations:create', 'Keep')
      await ipc.invoke('conversations:deleteMany', [])
      const list = await ipc.invoke('conversations:list') as any[]
      expect(list).toHaveLength(1)
    })

    it('rejects invalid ids', async () => {
      await expect(ipc.invoke('conversations:deleteMany', [-1])).rejects.toThrow()
    })
  })

  describe('moveMany', () => {
    it('moves multiple conversations to a folder', async () => {
      const folder = await ipc.invoke('folders:create', 'Target') as any
      const c1 = await ipc.invoke('conversations:create', 'A') as any
      const c2 = await ipc.invoke('conversations:create', 'B') as any

      await ipc.invoke('conversations:moveMany', [c1.id, c2.id], folder.id)

      const updated1 = await ipc.invoke('conversations:get', c1.id) as any
      const updated2 = await ipc.invoke('conversations:get', c2.id) as any
      expect(updated1.folder_id).toBe(folder.id)
      expect(updated2.folder_id).toBe(folder.id)
    })

    it('moves to unfiled (null folder)', async () => {
      const folder = await ipc.invoke('folders:create', 'Source') as any
      const c = await ipc.invoke('conversations:create', 'X') as any
      await ipc.invoke('conversations:update', c.id, { folder_id: folder.id })

      await ipc.invoke('conversations:moveMany', [c.id], null)

      const updated = await ipc.invoke('conversations:get', c.id) as any
      expect(updated.folder_id).toBeNull()
    })

    it('is a no-op for empty array', async () => {
      await ipc.invoke('conversations:moveMany', [], null)
      // No error thrown
    })
  })

  describe('fork', () => {
    it('creates a new conversation with "Fork: " prefix title', async () => {
      const conv = await ipc.invoke('conversations:create', 'Original Chat') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'hello', '2025-01-01T00:00:01Z')
      const msg = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(conv.id) as any

      const fork = await ipc.invoke('conversations:fork', conv.id, msg.id) as any
      expect(fork.title).toBe('Fork: Original Chat')
      expect(fork.id).not.toBe(conv.id)
    })

    it('copies messages up to and including the target message', async () => {
      const conv = await ipc.invoke('conversations:create', 'Test') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'msg1', '2025-01-01T00:00:01Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'assistant', 'msg2', '2025-01-01T00:00:02Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'msg3', '2025-01-01T00:00:03Z')
      const targetMsg = db.prepare("SELECT * FROM messages WHERE content = 'msg2'").get() as any

      const fork = await ipc.invoke('conversations:fork', conv.id, targetMsg.id) as any
      const forkFull = await ipc.invoke('conversations:get', fork.id) as any
      expect(forkFull.messages).toHaveLength(2)
      expect(forkFull.messages[0].content).toBe('msg1')
      expect(forkFull.messages[1].content).toBe('msg2')
    })

    it('respects cleared_at boundary', async () => {
      const conv = await ipc.invoke('conversations:create', 'Cleared') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'before-clear', '2025-01-01T00:00:01Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'assistant', 'also-before', '2025-01-01T00:00:02Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'after-clear', '2025-01-01T00:00:04Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'assistant', 'response', '2025-01-01T00:00:05Z')
      await ipc.invoke('conversations:update', conv.id, { cleared_at: '2025-01-01T00:00:03Z' })
      const targetMsg = db.prepare("SELECT * FROM messages WHERE content = 'response'").get() as any

      const fork = await ipc.invoke('conversations:fork', conv.id, targetMsg.id) as any
      const forkFull = await ipc.invoke('conversations:get', fork.id) as any
      expect(forkFull.messages).toHaveLength(2)
      expect(forkFull.messages[0].content).toBe('after-clear')
      expect(forkFull.messages[1].content).toBe('response')
    })

    it('clones folder_id, cwd, model, system_prompt, ai_overrides, kb_enabled', async () => {
      const folder = await ipc.invoke('folders:create', 'TestFolder') as any
      const conv = await ipc.invoke('conversations:create', 'Settings Test') as any
      await ipc.invoke('conversations:update', conv.id, {
        folder_id: folder.id,
        cwd: '/tmp/work',
        model: 'claude-opus-4-6-20250725',
        system_prompt: 'Be helpful',
        ai_overrides: '{"temperature":"0.5"}',
        kb_enabled: 1,
      })
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'hello', '2025-01-01T00:00:01Z')
      const msg = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').get(conv.id) as any

      const fork = await ipc.invoke('conversations:fork', conv.id, msg.id) as any
      expect(fork.folder_id).toBe(folder.id)
      expect(fork.cwd).toBe('/tmp/work')
      expect(fork.model).toBe('claude-opus-4-6-20250725')
      expect(fork.system_prompt).toBe('Be helpful')
      expect(fork.ai_overrides).toBe('{"temperature":"0.5"}')
      expect(fork.kb_enabled).toBe(1)
      expect(fork.cleared_at).toBeNull()
    })

    it('copies attachments and tool_calls JSON', async () => {
      const conv = await ipc.invoke('conversations:create', 'Attachments') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(conv.id, 'user', 'with files', '[{"path":"/tmp/a.png"}]', null, '2025-01-01T00:00:01Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(conv.id, 'assistant', 'used tools', '[]', '[{"name":"bash","input":"ls"}]', '2025-01-01T00:00:02Z')
      const targetMsg = db.prepare("SELECT * FROM messages WHERE content = 'used tools'").get() as any

      const fork = await ipc.invoke('conversations:fork', conv.id, targetMsg.id) as any
      const forkFull = await ipc.invoke('conversations:get', fork.id) as any
      expect(forkFull.messages[0].attachments).toBe('[{"path":"/tmp/a.png"}]')
      expect(forkFull.messages[1].tool_calls).toBe('[{"name":"bash","input":"ls"}]')
    })

    it('fork from message before cleared_at ignores the boundary', async () => {
      const conv = await ipc.invoke('conversations:create', 'Pre-Clear Fork') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'old-msg', '2025-01-01T00:00:01Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'assistant', 'old-reply', '2025-01-01T00:00:02Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'new-msg', '2025-01-01T00:00:04Z')
      await ipc.invoke('conversations:update', conv.id, { cleared_at: '2025-01-01T00:00:03Z' })
      const targetMsg = db.prepare("SELECT * FROM messages WHERE content = 'old-reply'").get() as any

      const fork = await ipc.invoke('conversations:fork', conv.id, targetMsg.id) as any
      const forkFull = await ipc.invoke('conversations:get', fork.id) as any
      expect(forkFull.messages).toHaveLength(2)
      expect(forkFull.messages[0].content).toBe('old-msg')
      expect(forkFull.messages[1].content).toBe('old-reply')
      expect(fork.compact_summary).toBeNull()
    })

    it('fork from after cleared_at copies compact_summary', async () => {
      const conv = await ipc.invoke('conversations:create', 'Compact Fork') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'old', '2025-01-01T00:00:01Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'recent', '2025-01-01T00:00:04Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'assistant', 'reply', '2025-01-01T00:00:05Z')
      await ipc.invoke('conversations:update', conv.id, {
        cleared_at: '2025-01-01T00:00:03Z',
        compact_summary: 'Summary of old conversation',
      })
      const targetMsg = db.prepare("SELECT * FROM messages WHERE content = 'reply'").get() as any

      const fork = await ipc.invoke('conversations:fork', conv.id, targetMsg.id) as any
      const forkFull = await ipc.invoke('conversations:get', fork.id) as any
      expect(forkFull.messages).toHaveLength(2)
      expect(forkFull.messages[0].content).toBe('recent')
      expect(fork.compact_summary).toBe('Summary of old conversation')
      expect(fork.cleared_at).toBeNull()
    })

    it('throws on invalid conversationId', async () => {
      await expect(ipc.invoke('conversations:fork', -1, 1)).rejects.toThrow()
    })

    it('throws on nonexistent conversation', async () => {
      await expect(ipc.invoke('conversations:fork', 99999, 1)).rejects.toThrow('Conversation not found')
    })

    it('throws on nonexistent message', async () => {
      const conv = await ipc.invoke('conversations:create', 'Empty') as any
      await expect(ipc.invoke('conversations:fork', conv.id, 99999)).rejects.toThrow('Message not found')
    })
  })

  describe('color', () => {
    it('sets color on a conversation via update', async () => {
      const conv = await ipc.invoke('conversations:create', 'Colored') as any
      await ipc.invoke('conversations:update', conv.id, { color: '#ef4444' })
      const updated = await ipc.invoke('conversations:get', conv.id) as any
      expect(updated.color).toBe('#ef4444')
    })

    it('clears color with null', async () => {
      const conv = await ipc.invoke('conversations:create', 'Colored') as any
      await ipc.invoke('conversations:update', conv.id, { color: '#ef4444' })
      await ipc.invoke('conversations:update', conv.id, { color: null })
      const updated = await ipc.invoke('conversations:get', conv.id) as any
      expect(updated.color).toBeNull()
    })

    it('rejects invalid color format', async () => {
      const conv = await ipc.invoke('conversations:create', 'Bad') as any
      await expect(
        ipc.invoke('conversations:update', conv.id, { color: 'red' })
      ).rejects.toThrow('color must be a valid hex color')
    })

    it('defaults color to null on new conversations', async () => {
      const conv = await ipc.invoke('conversations:create', 'No Color') as any
      expect(conv.color).toBeNull()
    })

    it('colorMany sets color on multiple conversations', async () => {
      const c1 = await ipc.invoke('conversations:create', 'A') as any
      const c2 = await ipc.invoke('conversations:create', 'B') as any
      await ipc.invoke('conversations:colorMany', [c1.id, c2.id], '#22c55e')
      const u1 = await ipc.invoke('conversations:get', c1.id) as any
      const u2 = await ipc.invoke('conversations:get', c2.id) as any
      expect(u1.color).toBe('#22c55e')
      expect(u2.color).toBe('#22c55e')
    })

    it('colorMany clears color with null', async () => {
      const c1 = await ipc.invoke('conversations:create', 'A') as any
      await ipc.invoke('conversations:update', c1.id, { color: '#ef4444' })
      await ipc.invoke('conversations:colorMany', [c1.id], null)
      const u1 = await ipc.invoke('conversations:get', c1.id) as any
      expect(u1.color).toBeNull()
    })

    it('colorMany rejects invalid ids', async () => {
      await expect(ipc.invoke('conversations:colorMany', [-1], '#ef4444')).rejects.toThrow()
    })

    it('colorMany rejects invalid color', async () => {
      const c1 = await ipc.invoke('conversations:create', 'A') as any
      await expect(ipc.invoke('conversations:colorMany', [c1.id], 'bad')).rejects.toThrow('color must be a valid hex color')
    })
  })
})
