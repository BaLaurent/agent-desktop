import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { validateString } from '../utils/validate'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('settings:get', async () => {
    try {
      const rows = db.prepare('SELECT key, value FROM settings').all() as {
        key: string
        value: string
      }[]
      const result: Record<string, string> = {}
      for (const row of rows) {
        result[row.key] = row.value
      }
      return result
    } catch (err) {
      throw new Error(`Failed to get settings: ${(err as Error).message}`)
    }
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    try {
      validateString(key, 'key', 200)
      validateString(value, 'value', 10_000)
      db.prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      ).run(key, value)
    } catch (err) {
      throw new Error(`Failed to set setting: ${(err as Error).message}`)
    }
  })
}
