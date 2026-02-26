import { initMemoryAdapter, SqlJsAdapter } from './sqljs-adapter'
import { createTables } from './schema'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => '/tmp') },
}))

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

  it('mcp_servers type column defaults to stdio', async () => {
    const db = await createTestDb()
    createTables(db as any)

    db.prepare("INSERT INTO mcp_servers (name, command) VALUES ('test', 'node')").run()
    const row = db.prepare('SELECT type FROM mcp_servers WHERE name = ?').get('test') as { type: string }
    expect(row.type).toBe('stdio')
    db.close()
  })
})
