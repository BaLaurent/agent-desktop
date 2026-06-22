/**
 * Tests for the DB init singleton's corruption-recovery path.
 *
 * The contract the user cares about: a broken on-disk DB must NEVER be lost
 * silently — a `.corrupt.*` backup is always written before recovery, and the
 * app still boots with a fresh, usable DB.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initDatabase, getDatabase, closeDatabase } from './database'

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdb-corrupt-'))
  return path.join(dir, 'agent.db')
}

afterEach(() => {
  closeDatabase()
})

describe('initDatabase — corruption recovery', () => {
  it('backs up a corrupt DB and recreates a usable one', async () => {
    const dbPath = tmpDbPath()
    const garbage = Buffer.from('this is not a database at all\n')
    fs.writeFileSync(dbPath, garbage)

    await expect(initDatabase(dbPath)).resolves.toBeUndefined()

    // A backup must exist and contain the original (corrupt) bytes verbatim.
    const dir = path.dirname(dbPath)
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('agent.db.corrupt.'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, backups[0]))).toEqual(garbage)

    // The recreated DB is fresh and usable (schema present).
    const db = getDatabase()
    const tables = db.pragma('table_info(conversations)') as unknown[]
    expect(tables.length).toBeGreaterThan(0)
  })
})
