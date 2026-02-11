import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { validatePathSafe } from '../utils/validate'
import { IMAGE_EXTENSIONS_DOTTED, TEXT_EXTENSIONS, getMimeType } from '../utils/mime'

export { getMimeType } from '../utils/mime'

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('attachments:readFile', async (_e, filePath: string) => {
    // Validate path safety before any fs access
    validatePathSafe(filePath)

    const stats = await fs.promises.stat(filePath)

    // Enforce 100MB file size limit
    if (stats.size > 100_000_000) {
      throw new Error('File size exceeds 100MB limit')
    }

    const ext = path.extname(filePath).toLowerCase()
    const name = path.basename(filePath)
    const type = getMimeType(ext)
    const size = stats.size

    let content: string
    if (IMAGE_EXTENSIONS_DOTTED.has(ext)) {
      content = (await fs.promises.readFile(filePath)).toString('base64')
    } else if (TEXT_EXTENSIONS.has(ext)) {
      content = await fs.promises.readFile(filePath, 'utf-8')
    } else {
      // PDF and other types: return path only, no content reading
      content = filePath
    }

    return { name, content, type, size }
  })

  ipcMain.handle('attachments:getInfo', async (_e, filePath: string) => {
    // Validate path safety before any fs access
    validatePathSafe(filePath)

    const stats = await fs.promises.stat(filePath)

    // Enforce 100MB file size limit
    if (stats.size > 100_000_000) {
      throw new Error('File size exceeds 100MB limit')
    }

    const ext = path.extname(filePath).toLowerCase()
    return {
      name: path.basename(filePath),
      size: stats.size,
      type: getMimeType(ext)
    }
  })
}
