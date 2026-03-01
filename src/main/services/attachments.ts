import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { validatePathSafe } from '../utils/validate'
import { IMAGE_EXTENSIONS_DOTTED, TEXT_EXTENSIONS, getMimeType } from '../utils/mime'

export { getMimeType } from '../utils/mime'

const MAX_IMAGE_FILE_SIZE = 100_000_000 // 100MB — images/binary
const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024 // 10MB — text files freeze the renderer at larger sizes

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('attachments:readFile', async (_e, filePath: string) => {
    // Validate path safety before any fs access
    validatePathSafe(filePath)

    const stats = await fs.promises.stat(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const name = path.basename(filePath)
    const type = getMimeType(ext)
    const size = stats.size

    // Apply appropriate size limit based on file type
    if (TEXT_EXTENSIONS.has(ext)) {
      if (size > MAX_TEXT_FILE_SIZE) {
        throw new Error(`Text file size exceeds ${MAX_TEXT_FILE_SIZE / 1024 / 1024}MB limit`)
      }
    } else if (size > MAX_IMAGE_FILE_SIZE) {
      throw new Error('File size exceeds 100MB limit')
    }

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
    const ext = path.extname(filePath).toLowerCase()

    // Apply appropriate size limit based on file type
    if (TEXT_EXTENSIONS.has(ext)) {
      if (stats.size > MAX_TEXT_FILE_SIZE) {
        throw new Error(`Text file size exceeds ${MAX_TEXT_FILE_SIZE / 1024 / 1024}MB limit`)
      }
    } else if (stats.size > MAX_IMAGE_FILE_SIZE) {
      throw new Error('File size exceeds 100MB limit')
    }

    return {
      name: path.basename(filePath),
      size: stats.size,
      type: getMimeType(ext)
    }
  })
}
