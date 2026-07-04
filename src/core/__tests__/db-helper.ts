import type Database from 'better-sqlite3'
import { initMemoryAdapter } from '../db/sqljs-adapter'
import { createTables } from '../db/schema'
import { runMigrations } from '../db/migrations'
import { seedDefaults } from '../db/seed'

export async function createTestDb() {
  const db = await initMemoryAdapter()
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // SqlJsAdapter duck-types better-sqlite3's Database; the schema/migration/seed helpers declare
  // the nominal better-sqlite3 type, which can't unify with the adapter. Bridge once here — the
  // same boundary cast registerServices.ts applies for the live db.
  const bridged = db as unknown as Database.Database
  createTables(bridged)
  runMigrations(bridged)
  seedDefaults(bridged)
  return db
}
