import fs from 'fs'
import { initAdapter, SqlJsAdapter } from './sqljs-adapter'
import { createTables } from './schema'
import { runMigrations } from './migrations'
import { seedDefaults } from './seed'
import { createLogger } from '../utils/logger'

const log = createLogger('database')

let db: SqlJsAdapter | null = null

/** SQLite/sql.js signatures for an unreadable on-disk database file. */
function isCorruptionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return msg.includes('malformed')
    || msg.includes('not a database')
    || msg.includes('disk image')
    || msg.includes('file is encrypted')
}

/**
 * Initialize the database singleton.
 * @param dbPath Absolute path to the .db file
 * @param wasmPath Optional path to sql-wasm.wasm (for packaged Electron apps)
 */
export async function initDatabase(dbPath: string, wasmPath?: string): Promise<void> {
  if (db) return

  try {
    db = await initAdapter(dbPath, wasmPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    createTables(db as any)
    runMigrations(db as any)
    seedDefaults(db as any)
  } catch (err) {
    db = null

    // ALWAYS keep a backup before any recovery — the user must never lose data
    // silently, whatever the failure. Copy (not move) so the original stays put
    // for the loud-failure branch below.
    const backupPath = dbPath + '.corrupt.' + Date.now()
    try { fs.copyFileSync(dbPath, backupPath) } catch { /* no file yet, or unreadable */ }

    // Only auto-recreate on genuine on-disk corruption. Any other init error
    // (a migration bug, a transient FS failure) must fail loudly — otherwise we
    // silently start from an empty DB, which reads as "my database got deleted".
    // The backup above guarantees the data is still recoverable either way.
    if (!isCorruptionError(err)) throw err

    // Corruption: move the bad file aside and start fresh so the app can boot.
    try { fs.rmSync(dbPath, { force: true }) } catch { /* best effort */ }
    db = await initAdapter(dbPath, wasmPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    createTables(db as any)
    seedDefaults(db as any)
    log.error('Recreated after corruption', undefined, { backupPath })
  }
}

export function getDatabase(): SqlJsAdapter {
  if (!db) throw new Error('Database not initialized — call initDatabase() first')
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.flush()
    db.close()
    db = null
  }
}
