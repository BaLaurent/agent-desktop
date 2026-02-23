import { initMemoryAdapter } from '../db/sqljs-adapter'
import { createTables } from '../db/schema'
import { runMigrations } from '../db/migrations'
import { seedDefaults } from '../db/seed'

export async function createTestDb() {
  const db = await initMemoryAdapter()
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createTables(db as any)
  runMigrations(db as any)
  seedDefaults(db as any)
  return db
}
