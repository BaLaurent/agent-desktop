import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './folders'
import type Database from 'better-sqlite3'

describe('Folders Service', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(async () => {
    db = await createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
  })

  afterEach(() => {
    db.close()
  })

  it('default folder is auto-created on startup with is_default=1', async () => {
    const list = await ipc.invoke('folders:list') as any[]
    const defaultFolder = list.find((f: any) => f.is_default === 1)
    expect(defaultFolder).toBeDefined()
    expect(defaultFolder.name).toBe('Unsorted')
    expect(defaultFolder.position).toBe(-1)
  })

  it('getDefault returns the default folder', async () => {
    const defaultFolder = await ipc.invoke('folders:getDefault') as any
    expect(defaultFolder).toBeDefined()
    expect(defaultFolder.is_default).toBe(1)
    expect(defaultFolder.name).toBe('Unsorted')
  })

  it('create returns folder with name and id', async () => {
    const folder = await ipc.invoke('folders:create', 'My Folder') as any
    expect(folder).toBeDefined()
    expect(folder.id).toBeGreaterThan(0)
    expect(folder.name).toBe('My Folder')
  })

  it('create with parentId sets parent_id', async () => {
    const parent = await ipc.invoke('folders:create', 'Parent') as any
    const child = await ipc.invoke('folders:create', 'Child', parent.id) as any
    expect(child.parent_id).toBe(parent.id)
  })

  it('list returns folders ordered by position ASC', async () => {
    await ipc.invoke('folders:create', 'A')
    await ipc.invoke('folders:create', 'B')
    await ipc.invoke('folders:create', 'C')

    const list = await ipc.invoke('folders:list') as any[]
    // Default folder (position -1) comes first, then user folders
    expect(list.length).toBe(4)
    expect(list[0].name).toBe('Unsorted')
    expect(list[0].position).toBe(-1)
    expect(list[1].name).toBe('A')
    expect(list[1].position).toBe(0)
    expect(list[2].name).toBe('B')
    expect(list[2].position).toBe(1)
    expect(list[3].name).toBe('C')
    expect(list[3].position).toBe(2)
  })

  it('update name changes name', async () => {
    const folder = await ipc.invoke('folders:create', 'Old Name') as any
    await ipc.invoke('folders:update', folder.id, { name: 'New Name' })
    const list = await ipc.invoke('folders:list') as any[]
    const updated = list.find((f: any) => f.id === folder.id)
    expect(updated.name).toBe('New Name')
  })

  it('delete reparents conversations to default folder', async () => {
    const folder = await ipc.invoke('folders:create', 'Doomed') as any
    db.prepare('INSERT INTO conversations (title, folder_id) VALUES (?, ?)').run('Orphan', folder.id)

    await ipc.invoke('folders:delete', folder.id)

    const conv = db.prepare('SELECT folder_id FROM conversations WHERE title = ?').get('Orphan') as any
    const defaultFolder = db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as any
    expect(conv.folder_id).toBe(defaultFolder.id)
  })

  it('delete reparents child folders (parent_id → null)', async () => {
    const parent = await ipc.invoke('folders:create', 'Parent') as any
    const child = await ipc.invoke('folders:create', 'Child', parent.id) as any

    await ipc.invoke('folders:delete', parent.id)

    const list = await ipc.invoke('folders:list') as any[]
    const orphaned = list.find((f: any) => f.id === child.id)
    expect(orphaned.parent_id).toBeNull()
  })

  it('reorder updates positions transactionally', async () => {
    const list0 = await ipc.invoke('folders:list') as any[]
    const defaultFolder = list0.find((f: any) => f.is_default === 1)
    const a = await ipc.invoke('folders:create', 'A') as any
    const b = await ipc.invoke('folders:create', 'B') as any
    const c = await ipc.invoke('folders:create', 'C') as any

    // Reverse user folders, keep default folder at front
    await ipc.invoke('folders:reorder', [defaultFolder.id, c.id, b.id, a.id])

    const list = await ipc.invoke('folders:list') as any[]
    expect(list[0].name).toBe('Unsorted')
    expect(list[0].position).toBe(0)
    expect(list[1].name).toBe('C')
    expect(list[1].position).toBe(1)
    expect(list[2].name).toBe('B')
    expect(list[2].position).toBe(2)
    expect(list[3].name).toBe('A')
    expect(list[3].position).toBe(3)
  })

  it('create assigns incremental positions', async () => {
    const f1 = await ipc.invoke('folders:create', 'First') as any
    const f2 = await ipc.invoke('folders:create', 'Second') as any
    expect(f2.position).toBe(f1.position + 1)
  })

  it('update default_cwd sets and retrieves correctly', async () => {
    const folder = await ipc.invoke('folders:create', 'WithCwd') as any
    await ipc.invoke('folders:update', folder.id, { default_cwd: '/home/user/projects' })
    const list = await ipc.invoke('folders:list') as any[]
    const updated = list.find((f: any) => f.id === folder.id)
    expect(updated.default_cwd).toBe('/home/user/projects')
  })

  it('update default_cwd to null clears it', async () => {
    const folder = await ipc.invoke('folders:create', 'ClearCwd') as any
    await ipc.invoke('folders:update', folder.id, { default_cwd: '/tmp' })
    await ipc.invoke('folders:update', folder.id, { default_cwd: null })
    const list = await ipc.invoke('folders:list') as any[]
    const updated = list.find((f: any) => f.id === folder.id)
    expect(updated.default_cwd).toBeNull()
  })

  describe('update color', () => {
    it('sets a valid hex color', async () => {
      const folder = await ipc.invoke('folders:create', 'Colored') as any
      await ipc.invoke('folders:update', folder.id, { color: '#ff00aa' })
      const list = await ipc.invoke('folders:list') as any[]
      const updated = list.find((f: any) => f.id === folder.id)
      expect(updated.color).toBe('#ff00aa')
    })

    it('accepts uppercase hex color', async () => {
      const folder = await ipc.invoke('folders:create', 'Upper') as any
      await ipc.invoke('folders:update', folder.id, { color: '#AABBCC' })
      const list = await ipc.invoke('folders:list') as any[]
      const updated = list.find((f: any) => f.id === folder.id)
      expect(updated.color).toBe('#AABBCC')
    })

    it('clears color with null', async () => {
      const folder = await ipc.invoke('folders:create', 'ClearColor') as any
      await ipc.invoke('folders:update', folder.id, { color: '#112233' })
      await ipc.invoke('folders:update', folder.id, { color: null })
      const list = await ipc.invoke('folders:list') as any[]
      const updated = list.find((f: any) => f.id === folder.id)
      expect(updated.color).toBeNull()
    })

    it('rejects invalid hex color (missing #)', async () => {
      const folder = await ipc.invoke('folders:create', 'Bad1') as any
      await expect(ipc.invoke('folders:update', folder.id, { color: 'ff00aa' })).rejects.toThrow('color must be a valid hex color')
    })

    it('rejects short hex color (#rgb)', async () => {
      const folder = await ipc.invoke('folders:create', 'Bad2') as any
      await expect(ipc.invoke('folders:update', folder.id, { color: '#f0a' })).rejects.toThrow('color must be a valid hex color')
    })

    it('rejects hex color with alpha (#rrggbbaa)', async () => {
      const folder = await ipc.invoke('folders:create', 'Bad3') as any
      await expect(ipc.invoke('folders:update', folder.id, { color: '#ff00aaff' })).rejects.toThrow('color must be a valid hex color')
    })

    it('rejects non-hex characters', async () => {
      const folder = await ipc.invoke('folders:create', 'Bad4') as any
      await expect(ipc.invoke('folders:update', folder.id, { color: '#gghhii' })).rejects.toThrow('color must be a valid hex color')
    })
  })

  it('delete refuses to delete the default folder', async () => {
    const list = await ipc.invoke('folders:list') as any[]
    const defaultFolder = list.find((f: any) => f.is_default === 1)
    await expect(ipc.invoke('folders:delete', defaultFolder.id)).rejects.toThrow()
  })

  it('delete with mode=delete refuses to delete the default folder', async () => {
    const list = await ipc.invoke('folders:list') as any[]
    const defaultFolder = list.find((f: any) => f.is_default === 1)
    await expect(ipc.invoke('folders:delete', defaultFolder.id, 'delete')).rejects.toThrow()
  })

  describe('delete with mode', () => {
    it('mode=delete removes conversations in folder', async () => {
      const folder = await ipc.invoke('folders:create', 'Purge') as any
      db.prepare('INSERT INTO conversations (title, folder_id) VALUES (?, ?)').run('Gone', folder.id)
      db.prepare('INSERT INTO conversations (title, folder_id) VALUES (?, ?)').run('Also Gone', folder.id)

      await ipc.invoke('folders:delete', folder.id, 'delete')

      const convs = db.prepare('SELECT * FROM conversations WHERE folder_id = ?').all(folder.id)
      expect(convs).toHaveLength(0)
      const allConvs = db.prepare('SELECT * FROM conversations').all()
      expect(allConvs).toHaveLength(0)
    })

    it('mode=delete cascades messages via FK', async () => {
      const folder = await ipc.invoke('folders:create', 'Purge') as any
      const result = db.prepare('INSERT INTO conversations (title, folder_id) VALUES (?, ?)').run('WithMsgs', folder.id)
      const convId = result.lastInsertRowid
      db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(convId, 'user', 'hello')
      db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)').run(convId, 'assistant', 'hi')

      await ipc.invoke('folders:delete', folder.id, 'delete')

      const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(convId)
      expect(msgs).toHaveLength(0)
    })

    it('mode=delete removes child folders recursively', async () => {
      const parent = await ipc.invoke('folders:create', 'Parent') as any
      const child = await ipc.invoke('folders:create', 'Child', parent.id) as any
      const grandchild = await ipc.invoke('folders:create', 'Grandchild', child.id) as any
      db.prepare('INSERT INTO conversations (title, folder_id) VALUES (?, ?)').run('Deep', grandchild.id)

      await ipc.invoke('folders:delete', parent.id, 'delete')

      const folders = await ipc.invoke('folders:list') as any[]
      // Only the default folder remains
      expect(folders).toHaveLength(1)
      expect(folders[0].is_default).toBe(1)
      const convs = db.prepare('SELECT * FROM conversations').all()
      expect(convs).toHaveLength(0)
    })

    it('mode=delete preserves conversations outside folder', async () => {
      const folder = await ipc.invoke('folders:create', 'Target') as any
      db.prepare('INSERT INTO conversations (title, folder_id) VALUES (?, ?)').run('Inside', folder.id)
      db.prepare('INSERT INTO conversations (title) VALUES (?)').run('Outside')

      await ipc.invoke('folders:delete', folder.id, 'delete')

      const convs = db.prepare('SELECT * FROM conversations').all() as any[]
      expect(convs).toHaveLength(1)
      expect(convs[0].title).toBe('Outside')
    })

    it('default mode reparents to default folder', async () => {
      const folder = await ipc.invoke('folders:create', 'Old') as any
      db.prepare('INSERT INTO conversations (title, folder_id) VALUES (?, ?)').run('Kept', folder.id)

      await ipc.invoke('folders:delete', folder.id)

      const conv = db.prepare('SELECT folder_id FROM conversations WHERE title = ?').get('Kept') as any
      const defaultFolder = db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as any
      expect(conv.folder_id).toBe(defaultFolder.id)
    })
  })
})
