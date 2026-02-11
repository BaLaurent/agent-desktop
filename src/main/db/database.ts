import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import { createTables } from './schema'
import { runMigrations } from './migrations'
import { seedDefaults } from './seed'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'agent.db')
  db = new Database(dbPath)

  // WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  createTables(db)
  runMigrations(db)
  seedDefaults(db)

  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
