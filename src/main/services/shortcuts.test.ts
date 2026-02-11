import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './shortcuts'
import type Database from 'better-sqlite3'

describe('Shortcuts Service', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(() => {
    db = createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
  })

  afterEach(() => {
    db.close()
  })

  it('list returns seeded shortcuts (9 from seed.ts)', async () => {
    const shortcuts = await ipc.invoke('shortcuts:list') as any[]
    expect(shortcuts).toHaveLength(9)
  })

  it('shortcuts have action and keybinding fields', async () => {
    const shortcuts = await ipc.invoke('shortcuts:list') as any[]
    for (const s of shortcuts) {
      expect(s).toHaveProperty('action')
      expect(s).toHaveProperty('keybinding')
      expect(typeof s.action).toBe('string')
      expect(typeof s.keybinding).toBe('string')
    }
  })

  it('update keybinding changes the keybinding', async () => {
    const shortcuts = await ipc.invoke('shortcuts:list') as any[]
    const target = shortcuts[0]

    await ipc.invoke('shortcuts:update', target.id, 'Alt+Z')

    const updated = await ipc.invoke('shortcuts:list') as any[]
    const changed = updated.find((s: any) => s.id === target.id)
    expect(changed.keybinding).toBe('Alt+Z')
  })

  it('update nonexistent shortcut throws error', async () => {
    await expect(
      ipc.invoke('shortcuts:update', 99999, 'Alt+X')
    ).rejects.toThrow('Shortcut 99999 not found')
  })
})
