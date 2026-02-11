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
]

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)',
  'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(conversation_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_folder_id ON conversations(folder_id)',
  'CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id)',
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
    db.exec('ALTER TABLE conversations ADD COLUMN cwd TEXT')
  }

  // Add ai_overrides column to conversations and folders (cascading settings)
  if (!convCols.some((c) => c.name === 'ai_overrides')) {
    db.exec('ALTER TABLE conversations ADD COLUMN ai_overrides TEXT')
  }
  const folderCols = db.pragma('table_info(folders)') as { name: string }[]
  if (!folderCols.some((c) => c.name === 'ai_overrides')) {
    db.exec('ALTER TABLE folders ADD COLUMN ai_overrides TEXT')
  }

  // Add tool_calls column to messages (persisted tool call data)
  const msgCols = db.pragma('table_info(messages)') as { name: string }[]
  if (!msgCols.some((c) => c.name === 'tool_calls')) {
    db.exec('ALTER TABLE messages ADD COLUMN tool_calls TEXT')
  }

  // Add HTTP/SSE transport columns to mcp_servers
  const mcpCols = db.pragma('table_info(mcp_servers)') as { name: string }[]
  if (!mcpCols.some((c) => c.name === 'type')) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN type TEXT DEFAULT 'stdio'")
  }
  if (!mcpCols.some((c) => c.name === 'url')) {
    db.exec('ALTER TABLE mcp_servers ADD COLUMN url TEXT')
  }
  if (!mcpCols.some((c) => c.name === 'headers')) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN headers TEXT DEFAULT '{}'")
  }

  // Drop unused artifacts table (legacy from old Artifacts Pipeline)
  db.exec('DROP TABLE IF EXISTS artifacts')

  // Drop themes table (themes now stored as CSS files in ~/.agent-desktop/themes/)
  db.exec('DROP TABLE IF EXISTS themes')

  // Add default_cwd column to folders (default working directory for new conversations)
  const folderCols2 = db.pragma('table_info(folders)') as { name: string }[]
  if (!folderCols2.some((c) => c.name === 'default_cwd')) {
    db.exec('ALTER TABLE folders ADD COLUMN default_cwd TEXT')
  }
}
