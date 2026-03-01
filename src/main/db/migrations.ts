import type Database from 'better-sqlite3'

const CURRENT_VERSION = 2

export function runMigrations(db: Database.Database): void {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'db_version'").get() as
    | { value: string }
    | undefined

  const currentVersion = row ? parseInt(row.value, 10) : 0

  // Version 1: initial schema (already created by schema.ts)

  if (currentVersion < 2) {
    // Version 2: add max_runs to scheduled_tasks (replaces one_shot boolean)
    // Column addition + backfill handled in schema.ts runMigrations (idempotent ALTER TABLE)
  }

  if (currentVersion < CURRENT_VERSION) {
    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('db_version', ?, datetime('now'))"
    ).run(String(CURRENT_VERSION))
  }
}
