import { initMemoryAdapter, SqlJsAdapter } from './sqljs-adapter'
import { createTables } from './schema'


async function createTestDb() {
  const db = await initMemoryAdapter()
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

describe('schema', () => {
  it('createTables is idempotent (call twice, no error)', async () => {
    const db = await createTestDb()
    createTables(db as any)
    expect(() => createTables(db as any)).not.toThrow()
    db.close()
  })

  it('all expected tables exist', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]

    const tableNames = tables.map((t) => t.name)

    const expected = [
      'settings',
      'auth',
      'folders',
      'conversations',
      'messages',
      'mcp_servers',
      'knowledge_files',
      'conversation_knowledge',
      'keyboard_shortcuts',
    ]

    for (const name of expected) {
      expect(tableNames).toContain(name)
    }

    db.close()
  })

  it('cwd column exists on conversations table', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(conversations)') as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('cwd')
    db.close()
  })

  it('tool_calls column exists on messages table', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(messages)') as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('tool_calls')
    db.close()
  })

  it('stopped column exists on messages table', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(messages)') as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('stopped')
    db.close()
  })

  it('stopped column defaults to 0 for new rows', async () => {
    const db = await createTestDb()
    createTables(db as any)

    db.prepare("INSERT INTO conversations (title) VALUES ('T')").run()
    db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (1, 'assistant', 'hi')").run()
    const row = db.prepare('SELECT stopped FROM messages WHERE conversation_id = 1').get() as { stopped: number }

    expect(row.stopped).toBe(0)
    db.close()
  })

  it('mcp_servers has type, url, headers columns after migration', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(mcp_servers)') as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('type')
    expect(colNames).toContain('url')
    expect(colNames).toContain('headers')
    db.close()
  })

  it('folders has default_cwd column after migration', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(folders)') as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('default_cwd')
    db.close()
  })

  it('conversations has cleared_at column after migration', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(conversations)') as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('cleared_at')
    db.close()
  })

  it('conversations has sdk_session_id column after migration', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(conversations)') as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('sdk_session_id')
    db.close()
  })

  it('conversations table has pi_session_file column (v4)', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(conversations)') as { name: string; type: string }[]
    const piCol = cols.find(c => c.name === 'pi_session_file')
    expect(piCol).toBeDefined()
    expect(piCol?.type).toBe('TEXT')
    db.close()
  })

  it('conversations has last_*_tokens + last_usage_updated_at columns after migration', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(conversations)') as { name: string; type: string }[]
    const colMap = new Map(cols.map((c) => [c.name, c.type]))

    expect(colMap.get('last_input_tokens')).toBe('INTEGER')
    expect(colMap.get('last_output_tokens')).toBe('INTEGER')
    expect(colMap.get('last_cache_read_tokens')).toBe('INTEGER')
    expect(colMap.get('last_cache_creation_tokens')).toBe('INTEGER')
    expect(colMap.get('last_context_window')).toBe('INTEGER')
    expect(colMap.get('last_usage_updated_at')).toBe('TEXT')
    db.close()
  })

  it('mcp_servers type column defaults to stdio', async () => {
    const db = await createTestDb()
    createTables(db as any)

    db.prepare("INSERT INTO mcp_servers (name, command) VALUES ('test', 'node')").run()
    const row = db.prepare('SELECT type FROM mcp_servers WHERE name = ?').get('test') as { type: string }
    expect(row.type).toBe('stdio')
    db.close()
  })

  it('scheduled_tasks has pre_run_action column after migration', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const cols = db.pragma('table_info(scheduled_tasks)') as { name: string }[]
    const colNames = cols.map((c) => c.name)

    expect(colNames).toContain('pre_run_action')
    db.close()
  })

  it('scheduled_tasks pre_run_action defaults to none', async () => {
    const db = await createTestDb()
    createTables(db as any)

    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Test', 'claude-sonnet-4-6', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    db.prepare(
      "INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, next_run_at, created_at, updated_at) VALUES ('t', 'p', ?, 1, 'hours', datetime('now'), datetime('now'), datetime('now'))"
    ).run(convId)

    const row = db.prepare('SELECT pre_run_action FROM scheduled_tasks').get() as { pre_run_action: string }
    expect(row.pre_run_action).toBe('none')
    db.close()
  })
})
