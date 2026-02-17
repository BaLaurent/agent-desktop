import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { validateString, validatePositiveInt } from '../utils/validate'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('folders:list', () => {
    return db
      .prepare('SELECT * FROM folders ORDER BY position ASC, created_at ASC')
      .all()
  })

  ipcMain.handle('folders:create', (_e, name: string, parentId?: number) => {
    validateString(name, 'name', 500)
    if (parentId !== undefined) validatePositiveInt(parentId, 'parentId')
    const maxPos = db
      .prepare('SELECT COALESCE(MAX(position), -1) as max FROM folders')
      .get() as { max: number }
    const result = db
      .prepare(
        `INSERT INTO folders (name, parent_id, position, updated_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(name, parentId ?? null, maxPos.max + 1)
    return db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid)
  })

  ipcMain.handle(
    'folders:update',
    (_e, id: number, data: Record<string, unknown>) => {
      validatePositiveInt(id, 'folderId')
      if (data.name !== undefined) validateString(data.name as string, 'name', 500)
      if (data.ai_overrides !== undefined && data.ai_overrides !== null) validateString(data.ai_overrides as string, 'ai_overrides', 10_000)
      if (data.default_cwd !== undefined && data.default_cwd !== null) validateString(data.default_cwd as string, 'default_cwd', 1000)
      if ('parent_id' in data && data.parent_id !== null && data.parent_id !== undefined) {
        validatePositiveInt(data.parent_id as number, 'parent_id')
        if (data.parent_id === id) throw new Error('Folder cannot be its own parent')
        // Walk ancestors to detect cycle
        let current = data.parent_id as number
        const visited = new Set<number>([id])
        while (current) {
          if (visited.has(current)) throw new Error('Circular folder reference detected')
          visited.add(current)
          const parent = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(current) as { parent_id: number | null } | undefined
          current = parent?.parent_id ?? 0
        }
      }
      const allowed = ['name', 'parent_id', 'ai_overrides', 'default_cwd']
      const fields: string[] = []
      const values: unknown[] = []
      for (const key of allowed) {
        if (key in data) {
          fields.push(`${key} = ?`)
          values.push(data[key])
        }
      }
      if (fields.length === 0) return
      fields.push("updated_at = datetime('now')")
      values.push(id)
      db.prepare(`UPDATE folders SET ${fields.join(', ')} WHERE id = ?`).run(
        ...values
      )
    }
  )

  ipcMain.handle('folders:delete', (_e, id: number, mode?: string) => {
    validatePositiveInt(id, 'folderId')

    if (mode === 'delete') {
      // Collect this folder + all descendant folder IDs (BFS)
      const allIds: number[] = [id]
      const queue = [id]
      while (queue.length > 0) {
        const current = queue.shift()!
        const children = db
          .prepare('SELECT id FROM folders WHERE parent_id = ?')
          .all(current) as { id: number }[]
        for (const child of children) {
          allIds.push(child.id)
          queue.push(child.id)
        }
      }

      const placeholders = allIds.map(() => '?').join(',')
      const deleteAll = db.transaction(() => {
        // Delete conversations in all folders (messages cascade via FK)
        db.prepare(`DELETE FROM conversations WHERE folder_id IN (${placeholders})`).run(
          ...allIds
        )
        // Delete all descendant folders + this folder
        // Children first to respect FK, then parents — but SET NULL on parent_id means order doesn't matter
        db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...allIds)
      })
      deleteAll()
    } else {
      // Default: reparent conversations and child folders to root
      db.prepare('UPDATE conversations SET folder_id = NULL WHERE folder_id = ?').run(id)
      db.prepare('UPDATE folders SET parent_id = NULL WHERE parent_id = ?').run(id)
      db.prepare('DELETE FROM folders WHERE id = ?').run(id)
    }
  })

  ipcMain.handle('folders:reorder', (_e, ids: number[]) => {
    if (!Array.isArray(ids)) throw new Error('ids must be an array')
    for (const id of ids) validatePositiveInt(id, 'folderId')
    const stmt = db.prepare('UPDATE folders SET position = ? WHERE id = ?')
    const reorder = db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        stmt.run(i, ids[i])
      }
    })
    reorder()
  })
}
