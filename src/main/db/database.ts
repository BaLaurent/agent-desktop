import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { initAdapter, SqlJsAdapter } from './sqljs-adapter'
import { createTables } from './schema'
import { runMigrations } from './migrations'
import { seedDefaults } from './seed'

let db: SqlJsAdapter | null = null

export async function initDatabase(): Promise<void> {
  if (db) return

  const dbPath = path.join(app.getPath('userData'), 'agent.db')
  try {
    db = await initAdapter(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    createTables(db as any)
    runMigrations(db as any)
    seedDefaults(db as any)
  } catch (err) {
    // Backup corrupted DB, recreate from scratch
    const backupPath = dbPath + '.corrupt.' + Date.now()
    try { fs.renameSync(dbPath, backupPath) } catch {}
    db = await initAdapter(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    createTables(db as any)
    seedDefaults(db as any)
    console.error('[database] Recreated after corruption. Backup:', backupPath)
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
