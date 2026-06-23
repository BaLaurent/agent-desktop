import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../main/__tests__/db-helper'
import { seedGuideFolders, seedGuideFoldersOnce } from './guideFolders'

describe('seedGuideFolders', () => {
  let db: any
  beforeEach(async () => { db = await createTestDb() })

  it('crée 3 dossiers-guides, chacun avec une conversation + un message assistant', async () => {
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
      const msg = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').get(conv.id)
      expect(msg.role).toBe('assistant')
      expect(msg.content.length).toBeGreaterThan(0)
    }
  })

  it('est idempotent — un 2e appel ne crée rien', async () => {
    await seedGuideFolders(db)
    const { created } = await seedGuideFolders(db)
    expect(created).toBe(0)
    expect(db.prepare("SELECT COUNT(*) c FROM folders WHERE guide_type IS NOT NULL").get().c).toBe(3)
  })

  it('ne recrée que le type manquant', async () => {
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

  it('seede une fois puis pose le flag ; un 2e appel ne re-seede pas après suppression', async () => {
    await seedGuideFoldersOnce(db)
    expect(db.prepare("SELECT COUNT(*) c FROM folders WHERE guide_type IS NOT NULL").get().c).toBe(3)
    expect(db.prepare("SELECT value FROM settings WHERE key = 'guideFolders_seeded'").get().value).toBe('1')
    // L'utilisateur supprime tout ; le flag empêche la recréation auto.
    db.prepare("DELETE FROM folders WHERE guide_type IS NOT NULL").run()
    await seedGuideFoldersOnce(db)
    expect(db.prepare("SELECT COUNT(*) c FROM folders WHERE guide_type IS NOT NULL").get().c).toBe(0)
  })
})
