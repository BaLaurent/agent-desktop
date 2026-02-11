import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { LogEntry } from '../../shared/types'
import { app, dialog, shell, Notification } from 'electron'

const LOG_BUFFER_MAX = 500
const logBuffer: LogEntry[] = []

function logToBuffer(entry: LogEntry): void {
  logBuffer.push(entry)
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift()
  }
}

export function log(
  level: LogEntry['level'],
  message: string,
  details?: string
): void {
  logToBuffer({
    level,
    message,
    timestamp: new Date().toISOString(),
    details,
  })
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('system:getInfo', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    dbPath: app.getPath('userData'),
    configPath: app.getPath('userData'),
  }))

  ipcMain.handle('system:getLogs', async (_event, limit?: number) => {
    // Validate limit parameter
    if (limit !== undefined && (typeof limit !== 'number' || limit < 0)) {
      throw new Error('Invalid limit parameter')
    }
    const maxEntries = Math.min(limit ?? 100, 1000)
    return logBuffer.slice(-maxEntries)
  })

  ipcMain.handle('system:clearCache', async () => {
    logBuffer.length = 0
  })

  ipcMain.handle('system:openExternal', async (_event, url: string) => {
    // Validate URL and restrict to safe protocols
    if (typeof url !== 'string') {
      throw new Error('Invalid URL')
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Invalid URL format')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Blocked protocol: ${parsed.protocol}`)
    }
    await shell.openExternal(url)
  })

  ipcMain.handle(
    'system:showNotification',
    async (_event, title: string, body: string) => {
      // Validate notification parameters
      if (typeof title !== 'string' || typeof body !== 'string') {
        throw new Error('Notification title and body must be strings')
      }
      if (title.length > 500 || body.length > 500) {
        throw new Error('Notification title or body exceeds maximum length (500 chars)')
      }
      new Notification({ title, body }).show()
    }
  )

  ipcMain.handle('system:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select working directory',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('system:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Select file',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('system:purgeConversations', async () => {
    const purge = db.transaction(() => {
      const convCount = (db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }).c
      const folderCount = (db.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number }).c
      db.exec('DELETE FROM conversations') // cascades → messages, conversation_knowledge
      db.exec('DELETE FROM folders')
      return { conversations: convCount, folders: folderCount }
    })
    return purge()
  })

  ipcMain.handle('system:purgeAll', async () => {
    const purge = db.transaction(() => {
      const convCount = (db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }).c
      db.exec('DELETE FROM conversations') // cascades → messages, conversation_knowledge
      db.exec('DELETE FROM folders')
      db.exec('DELETE FROM knowledge_files')
      db.exec('DELETE FROM mcp_servers')
      db.exec('DELETE FROM keyboard_shortcuts')
      return { conversations: convCount }
    })
    return purge()
  })
}
