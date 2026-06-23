import type Database from 'better-sqlite3'
import type { SqlJsAdapter } from './sqljs-adapter'
import { getDefaultFolderId } from './queries'
import { createLogger, errToCtx } from '../utils/logger'

const log = createLogger('schema')

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
    model TEXT DEFAULT 'claude-sonnet-4-6',
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
    max_runs INTEGER DEFAULT NULL,
    one_shot INTEGER DEFAULT 0,
    notify_desktop INTEGER DEFAULT 1,
    notify_voice INTEGER DEFAULT 0,
    pre_run_action TEXT NOT NULL DEFAULT 'none',
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

/** Apply a single ADD COLUMN migration if the column does not yet exist. Idempotent. */
function applyMigration(
  db: Database.Database,
  columnsByTable: Map<string, Set<string>>,
  table: string,
  col: string,
  sqlPart: string
): void {
  if (columnsByTable.get(table)?.has(col)) return
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlPart}`)
    columnsByTable.get(table)?.add(col)
  } catch (e) {
    log.warn(`Migration skipped: ${table}.${col}`, errToCtx(e))
  }
}

function runMigrations(db: Database.Database): void {
  // Read schema once per table before any mutations
  const MIGRATION_TABLES = ['conversations', 'folders', 'messages', 'mcp_servers', 'scheduled_tasks'] as const
  const columnsByTable = new Map<string, Set<string>>()
  for (const table of MIGRATION_TABLES) {
    columnsByTable.set(
      table,
      new Set((db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name))
    )
  }

  db.transaction(() => {
    // conversations: core per-conversation settings
    applyMigration(db, columnsByTable, 'conversations', 'cwd', 'TEXT')
    applyMigration(db, columnsByTable, 'conversations', 'ai_overrides', 'TEXT')
    applyMigration(db, columnsByTable, 'conversations', 'cleared_at', 'TEXT')
    applyMigration(db, columnsByTable, 'conversations', 'compact_summary', 'TEXT')
    applyMigration(db, columnsByTable, 'conversations', 'sdk_session_id', 'TEXT')
    applyMigration(db, columnsByTable, 'conversations', 'pi_session_file', 'TEXT')
    applyMigration(db, columnsByTable, 'conversations', 'color', 'TEXT')
    applyMigration(db, columnsByTable, 'conversations', 'last_opened_at', 'TEXT')

    // conversations: context window usage tracking (for /context)
    applyMigration(db, columnsByTable, 'conversations', 'last_input_tokens', 'INTEGER')
    applyMigration(db, columnsByTable, 'conversations', 'last_output_tokens', 'INTEGER')
    applyMigration(db, columnsByTable, 'conversations', 'last_cache_read_tokens', 'INTEGER')
    applyMigration(db, columnsByTable, 'conversations', 'last_cache_creation_tokens', 'INTEGER')
    applyMigration(db, columnsByTable, 'conversations', 'last_usage_updated_at', 'TEXT')
    applyMigration(db, columnsByTable, 'conversations', 'last_context_window', 'INTEGER')
    // Content-only token count (system prompt + messages + compact + tool exchanges + skills),
    // matches the /context bubble headline so the status-line bar and bubble stay consistent.
    // Populated alongside last_*_tokens on every turn end in handlers/messages.ts.
    applyMigration(db, columnsByTable, 'conversations', 'last_content_tokens', 'INTEGER')

    // folders
    applyMigration(db, columnsByTable, 'folders', 'ai_overrides', 'TEXT')
    applyMigration(db, columnsByTable, 'folders', 'default_cwd', 'TEXT')
    applyMigration(db, columnsByTable, 'folders', 'color', 'TEXT')
    applyMigration(db, columnsByTable, 'folders', 'is_default', 'INTEGER DEFAULT 0')
    // Marqueur des dossiers-guides seedés (macros|functions|themes). NULL = dossier utilisateur normal.
    applyMigration(db, columnsByTable, 'folders', 'guide_type', 'TEXT')

    // messages
    applyMigration(db, columnsByTable, 'messages', 'tool_calls', 'TEXT')
    applyMigration(db, columnsByTable, 'messages', 'stopped', 'INTEGER DEFAULT 0')

    // mcp_servers: HTTP/SSE transport columns
    applyMigration(db, columnsByTable, 'mcp_servers', 'type', "TEXT DEFAULT 'stdio'")
    applyMigration(db, columnsByTable, 'mcp_servers', 'url', 'TEXT')
    applyMigration(db, columnsByTable, 'mcp_servers', 'headers', "TEXT DEFAULT '{}'")

    // scheduled_tasks
    applyMigration(db, columnsByTable, 'scheduled_tasks', 'one_shot', 'INTEGER DEFAULT 0')
    // max_runs replaces one_shot with N-run limit; backfill converts one_shot=1 rows
    if (!columnsByTable.get('scheduled_tasks')?.has('max_runs')) {
      try {
        db.exec('ALTER TABLE scheduled_tasks ADD COLUMN max_runs INTEGER DEFAULT NULL')
        db.exec('UPDATE scheduled_tasks SET max_runs = 1 WHERE one_shot = 1')
        columnsByTable.get('scheduled_tasks')?.add('max_runs')
      } catch (e) { log.warn('Migration skipped: scheduled_tasks.max_runs', errToCtx(e)) }
    }
    applyMigration(db, columnsByTable, 'scheduled_tasks', 'pre_run_action', "TEXT NOT NULL DEFAULT 'none'")

    // Drop legacy tables no longer in use
    try { db.exec('DROP TABLE IF EXISTS artifacts') } catch (e) { log.warn('Migration skipped: artifacts drop', errToCtx(e)) }
    try { db.exec('DROP TABLE IF EXISTS themes') } catch (e) { log.warn('Migration skipped: themes drop', errToCtx(e)) }

    // Ensure exactly one default folder exists (is_default must be added before this INSERT)
    if (getDefaultFolderId(db as unknown as SqlJsAdapter) === null) {
      db.prepare(
        `INSERT INTO folders (name, is_default, position, updated_at) VALUES ('Unsorted', 1, -1, datetime('now'))`
      ).run()
    }

    // Migrate all NULL folder_id conversations to the default folder
    const defaultFolderId = getDefaultFolderId(db as unknown as SqlJsAdapter)!
    db.prepare('UPDATE conversations SET folder_id = ? WHERE folder_id IS NULL').run(defaultFolderId)
  })()
}
