import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import { seedGuideFolders, seedGuideFoldersOnce } from './guideFolders'

describe('seedGuideFolders', () => {
  let db: any
  beforeEach(async () => { db = await createTestDb() })

  it('creates 3 guide folders, each with a conversation + an assistant message', async () => {
    const { created } = await seedGuideFolders(db)
    expect(created).toBe(3)
    const folders = db.prepare("SELECT * FROM folders WHERE guide_type IS NOT NULL").all()
    expect(folders).toHaveLength(3)
    const types = folders.map((f: any) => f.guide_type).sort()
    expect(types).toEqual(['functions', 'macros', 'themes'])
    for (const f of folders) {
      expect(f.default_cwd).toBeTruthy()
      const conv = db.prepare('SELECT * FROM conversations WHERE folder_id = ?').get(f.id)
      expect(conv).toBeTruthy()
      // The seeded conversation points to the same directory as its folder.
      expect(conv.cwd).toBe(f.default_cwd)
      const msg = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').get(conv.id)
      expect(msg.role).toBe('assistant')
      expect(msg.content.length).toBeGreaterThan(0)
    }
  })

  it('is idempotent — a second call creates nothing', async () => {
    await seedGuideFolders(db)
    const { created } = await seedGuideFolders(db)
    expect(created).toBe(0)
    expect(db.prepare("SELECT COUNT(*) c FROM folders WHERE guide_type IS NOT NULL").get().c).toBe(3)
  })

  it('recreates only the missing type', async () => {
    await seedGuideFolders(db)
    db.prepare("DELETE FROM folders WHERE guide_type = 'macros'").run()
    const { created } = await seedGuideFolders(db)
    expect(created).toBe(1)
    expect(db.prepare("SELECT id FROM folders WHERE guide_type = 'macros'").get()).toBeTruthy()
  })
})

describe('seedGuideFoldersOnce', () => {
  let db: any
  beforeEach(async () => { db = await createTestDb() })

  it('seeds once then sets the flag; a second call does not re-seed after deletion', async () => {
    await seedGuideFoldersOnce(db)
    expect(db.prepare("SELECT COUNT(*) c FROM folders WHERE guide_type IS NOT NULL").get().c).toBe(3)
    expect(db.prepare("SELECT value FROM settings WHERE key = 'guideFolders_seeded'").get().value).toBe('1')
    // The user deletes everything; the flag prevents auto re-creation.
    db.prepare("DELETE FROM folders WHERE guide_type IS NOT NULL").run()
    await seedGuideFoldersOnce(db)
    expect(db.prepare("SELECT COUNT(*) c FROM folders WHERE guide_type IS NOT NULL").get().c).toBe(0)
  })
})
