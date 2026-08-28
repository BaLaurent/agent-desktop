import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { app, dialog, shell, Notification, BrowserWindow } from 'electron'
import { getSessionType } from '../utils/env'

export { log } from '../../core/handlers/system'

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('system:getInfo', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    dbPath: app.getPath('userData'),
    configPath: app.getPath('userData'),
    sessionType: getSessionType(),
  }))

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

  ipcMain.handle('system:selectFolder', async (event) => {
    // Parent window makes the dialog sheet-modal on Linux/macOS so input events
    // don't leak to the renderer and trigger click-outside handlers on popovers.
    const parent = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null
    const options = {
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      title: 'Select working directory',
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('system:selectFile', async (event) => {
    const parent = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null
    const options = {
      properties: ['openFile'] as Array<'openFile'>,
      title: 'Select file',
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('system:saveFileDialog', async (event, defaultPath?: unknown, filters?: unknown) => {
    const parent = event?.sender ? BrowserWindow.fromWebContents(event.sender) : null
    const options: Electron.SaveDialogOptions = {
      title: 'Save file',
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
      filters: Array.isArray(filters)
        ? filters.filter((f: unknown): f is { name: string; extensions: string[] } =>
            !!f && typeof f === 'object' &&
            typeof (f as any).name === 'string' &&
            Array.isArray((f as any).extensions) &&
            (f as any).extensions.every((e: unknown) => typeof e === 'string'),
          )
        : undefined,
    }
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })
}
