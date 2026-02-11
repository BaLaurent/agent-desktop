import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './folders'
import type Database from 'better-sqlite3'

describe('Folders Service', () => {
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
    expect(list.length).toBe(3)
    expect(list[0].name).toBe('A')
    expect(list[0].position).toBe(0)
    expect(list[1].name).toBe('B')
    expect(list[1].position).toBe(1)
    expect(list[2].name).toBe('C')
    expect(list[2].position).toBe(2)
  })

  it('update name changes name', async () => {
    const folder = await ipc.invoke('folders:create', 'Old Name') as any
    await ipc.invoke('folders:update', folder.id, { name: 'New Name' })
    const list = await ipc.invoke('folders:list') as any[]
    const updated = list.find((f: any) => f.id === folder.id)
    expect(updated.name).toBe('New Name')
  })

  it('delete reparents conversations (folder_id → null)', async () => {
    const folder = await ipc.invoke('folders:create', 'Doomed') as any
    db.prepare('INSERT INTO conversations (title, folder_id) VALUES (?, ?)').run('Orphan', folder.id)

    await ipc.invoke('folders:delete', folder.id)

    const conv = db.prepare('SELECT folder_id FROM conversations WHERE title = ?').get('Orphan') as any
    expect(conv.folder_id).toBeNull()
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
    const a = await ipc.invoke('folders:create', 'A') as any
    const b = await ipc.invoke('folders:create', 'B') as any
    const c = await ipc.invoke('folders:create', 'C') as any

    // Reverse the order
    await ipc.invoke('folders:reorder', [c.id, b.id, a.id])

    const list = await ipc.invoke('folders:list') as any[]
    expect(list[0].name).toBe('C')
    expect(list[0].position).toBe(0)
    expect(list[1].name).toBe('B')
    expect(list[1].position).toBe(1)
    expect(list[2].name).toBe('A')
    expect(list[2].position).toBe(2)
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
      expect(folders).toHaveLength(0)
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

    it('default mode still reparents (backward compat)', async () => {
      const folder = await ipc.invoke('folders:create', 'Old') as any
      db.prepare('INSERT INTO conversations (title, folder_id) VALUES (?, ?)').run('Kept', folder.id)

      await ipc.invoke('folders:delete', folder.id)

      const conv = db.prepare('SELECT folder_id FROM conversations WHERE title = ?').get('Kept') as any
      expect(conv.folder_id).toBeNull()
    })
  })
})
