import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './conversations'
import type Database from 'better-sqlite3'

describe('Conversations Service', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(() => {
    db = createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
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
      conversation: { title: 'Imported Chat', model: 'claude-sonnet-4-5-20250929' },
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
})
