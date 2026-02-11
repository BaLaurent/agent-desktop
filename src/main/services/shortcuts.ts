import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { KeyboardShortcut } from '../../shared/types'
import { validateString, validatePositiveInt } from '../utils/validate'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('shortcuts:list', async () => {
    try {
      const rows = db
        .prepare('SELECT * FROM keyboard_shortcuts')
        .all() as KeyboardShortcut[]
      return rows
    } catch (err) {
      throw new Error(`Failed to list shortcuts: ${(err as Error).message}`)
    }
  })

  ipcMain.handle(
    'shortcuts:update',
    async (_event, id: number, keybinding: string) => {
      try {
        validatePositiveInt(id, 'shortcutId')
        validateString(keybinding, 'keybinding', 100)
        const existing = db
          .prepare('SELECT * FROM keyboard_shortcuts WHERE id = ?')
          .get(id) as KeyboardShortcut | undefined
        if (!existing) throw new Error(`Shortcut ${id} not found`)

        db.prepare(
          "UPDATE keyboard_shortcuts SET keybinding = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(keybinding, id)
      } catch (err) {
        throw new Error(`Failed to update shortcut: ${(err as Error).message}`)
      }
    }
  )
}
