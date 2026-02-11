import Database from 'better-sqlite3'
import { createTables } from '../db/schema'
import { runMigrations } from '../db/migrations'
import { seedDefaults } from '../db/seed'

export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createTables(db)
  runMigrations(db)
  seedDefaults(db)
  return db
}
