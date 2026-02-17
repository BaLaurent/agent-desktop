import Database from 'better-sqlite3'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { createTables } from './schema'
import { runMigrations } from './migrations'
import { seedDefaults } from './seed'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'agent.db')
  try {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    createTables(db)
    runMigrations(db)
    seedDefaults(db)
  } catch (err) {
    // Backup corrupted DB, recreate from scratch
    const backupPath = dbPath + '.corrupt.' + Date.now()
    try { fs.renameSync(dbPath, backupPath) } catch {}
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    createTables(db)
    seedDefaults(db)
    console.error('[database] Recreated after corruption. Backup:', backupPath)
  }

  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
