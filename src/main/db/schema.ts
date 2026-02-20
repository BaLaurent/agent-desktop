import type Database from 'better-sqlite3'

const TABLES = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS auth (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER,
    user_email TEXT,
    user_name TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    position INTEGER DEFAULT 0,
    ai_overrides TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'New Conversation',
    folder_id INTEGER,
    position INTEGER DEFAULT 0,
    model TEXT DEFAULT 'claude-sonnet-4-5-20250929',
    system_prompt TEXT,
    kb_enabled INTEGER DEFAULT 0,
    ai_overrides TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL DEFAULT '',
    attachments TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT DEFAULT '[]',
    env TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    status TEXT DEFAULT 'configured' CHECK(status IN ('configured', 'disabled', 'error')),
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS knowledge_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    size INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS conversation_knowledge (
    conversation_id INTEGER NOT NULL,
    knowledge_file_id INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, knowledge_file_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (knowledge_file_id) REFERENCES knowledge_files(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS keyboard_shortcuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL UNIQUE,
    keybinding TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    conversation_id INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    interval_value INTEGER NOT NULL DEFAULT 1,
    interval_unit TEXT NOT NULL DEFAULT 'hours',
    schedule_time TEXT,
    catch_up INTEGER DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    last_status TEXT,
    last_error TEXT,
    run_count INTEGER DEFAULT 0,
    one_shot INTEGER DEFAULT 0,
    notify_desktop INTEGER DEFAULT 1,
    notify_voice INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`,
]

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(conversation_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_folder_id ON conversations(folder_id)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id)',
  'CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(enabled, next_run_at)',
]

export function createTables(db: Database.Database): void {
  for (const sql of TABLES) {
    db.exec(sql)
  }
  for (const sql of INDEXES) {
    db.exec(sql)
  }
  runMigrations(db)
}

function runMigrations(db: Database.Database): void {
  // Add cwd column to conversations (working directory per conversation)
  const convCols = db.pragma('table_info(conversations)') as { name: string }[]
  if (!convCols.some((c) => c.name === 'cwd')) {
    try { db.exec('ALTER TABLE conversations ADD COLUMN cwd TEXT') } catch (e) { console.warn('[migration] conversations.cwd:', e) }
  }

  // Add ai_overrides column to conversations and folders (cascading settings)
  if (!convCols.some((c) => c.name === 'ai_overrides')) {
    try { db.exec('ALTER TABLE conversations ADD COLUMN ai_overrides TEXT') } catch (e) { console.warn('[migration] conversations.ai_overrides:', e) }
  }
  const folderCols = db.pragma('table_info(folders)') as { name: string }[]
  if (!folderCols.some((c) => c.name === 'ai_overrides')) {
    try { db.exec('ALTER TABLE folders ADD COLUMN ai_overrides TEXT') } catch (e) { console.warn('[migration] folders.ai_overrides:', e) }
  }

  // Add tool_calls column to messages (persisted tool call data)
  const msgCols = db.pragma('table_info(messages)') as { name: string }[]
  if (!msgCols.some((c) => c.name === 'tool_calls')) {
    try { db.exec('ALTER TABLE messages ADD COLUMN tool_calls TEXT') } catch (e) { console.warn('[migration] messages.tool_calls:', e) }
  }

  // Add HTTP/SSE transport columns to mcp_servers
  const mcpCols = db.pragma('table_info(mcp_servers)') as { name: string }[]
  if (!mcpCols.some((c) => c.name === 'type')) {
    try { db.exec("ALTER TABLE mcp_servers ADD COLUMN type TEXT DEFAULT 'stdio'") } catch (e) { console.warn('[migration] mcp_servers.type:', e) }
  }
  if (!mcpCols.some((c) => c.name === 'url')) {
    try { db.exec('ALTER TABLE mcp_servers ADD COLUMN url TEXT') } catch (e) { console.warn('[migration] mcp_servers.url:', e) }
  }
  if (!mcpCols.some((c) => c.name === 'headers')) {
    try { db.exec("ALTER TABLE mcp_servers ADD COLUMN headers TEXT DEFAULT '{}'") } catch (e) { console.warn('[migration] mcp_servers.headers:', e) }
  }

  // Drop unused artifacts table (legacy from old Artifacts Pipeline)
  try { db.exec('DROP TABLE IF EXISTS artifacts') } catch (e) { console.warn('[migration] artifacts drop:', e) }

  // Drop themes table (themes now stored as CSS files in ~/.agent-desktop/themes/)
  try { db.exec('DROP TABLE IF EXISTS themes') } catch (e) { console.warn('[migration] themes drop:', e) }

  // Add default_cwd column to folders (default working directory for new conversations)
  const folderCols2 = db.pragma('table_info(folders)') as { name: string }[]
  if (!folderCols2.some((c) => c.name === 'default_cwd')) {
    try { db.exec('ALTER TABLE folders ADD COLUMN default_cwd TEXT') } catch (e) { console.warn('[migration] folders.default_cwd:', e) }
  }

  // Add cleared_at column to conversations (context boundary for /clear command)
  if (!convCols.some((c) => c.name === 'cleared_at')) {
    try { db.exec('ALTER TABLE conversations ADD COLUMN cleared_at TEXT') } catch (e) { console.warn('[migration] conversations.cleared_at:', e) }
  }

  // Add one_shot column to scheduled_tasks (auto-disable after single execution)
  const schedCols = db.pragma('table_info(scheduled_tasks)') as { name: string }[]
  if (!schedCols.some((c) => c.name === 'one_shot')) {
    try { db.exec('ALTER TABLE scheduled_tasks ADD COLUMN one_shot INTEGER DEFAULT 0') } catch (e) { console.warn('[migration] scheduled_tasks.one_shot:', e) }
  }
}
