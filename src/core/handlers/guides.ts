import type Database from 'better-sqlite3'
import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { seedGuideFolders } from '../services/guideFolders'

export function registerGuidesHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('guides:reseed', async () => {
    try {
      return await seedGuideFolders(db as unknown as Database.Database)
    } catch (err) {
      throw new Error(`Failed to reseed guide folders: ${(err as Error).message}`)
    }
  })
}
