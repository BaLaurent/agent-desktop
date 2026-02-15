import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow, shell, Notification } from 'electron'
import type { IpcMain } from 'electron'
import type { UpdateInfo, UpdateStatus } from '../../shared/types'

let checkInterval: ReturnType<typeof setInterval> | null = null
let lastStatus: UpdateStatus = { state: 'idle' }
let getWindowFn: (() => BrowserWindow | null) | null = null
let onUpdateReadyCallback: (() => void) | null = null
let initialized = false

function sendStatus(status: UpdateStatus): void {
  lastStatus = status
  const win = getWindowFn?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send('updates:status', status)
  }
}

function isDebInstall(): boolean {
  return process.platform === 'linux' && !process.env.APPIMAGE
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch(() => {})
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}

export function initAutoUpdater(
  getWindow: () => BrowserWindow | null,
  onUpdateReady?: () => void,
): void {
  if (initialized) return
  initialized = true

  getWindowFn = getWindow
  onUpdateReadyCallback = onUpdateReady ?? null

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null // suppress verbose console logging

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    sendStatus({ state: 'available', version: info.version, releaseDate: info.releaseDate })
    new Notification({
      title: 'Update Available',
      body: `Version ${info.version} is available`,
    }).show()
  })

  autoUpdater.on('update-not-available', () => {
    sendStatus({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({ state: 'downloading', percent: progress.percent })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ state: 'downloaded', version: info.version })
    new Notification({
      title: 'Update Ready',
      body: `Version ${info.version} will be installed on restart`,
    }).show()
    onUpdateReadyCallback?.()
  })

  autoUpdater.on('error', (err) => {
    // 404 for latest-*.yml is expected when no release metadata exists yet
    if (err.message?.includes('latest-linux.yml') || err.message?.includes('latest-mac.yml') || err.message?.includes('latest.yml')) {
      sendStatus({ state: 'not-available' })
      return
    }
    sendStatus({ state: 'error', message: err.message })
  })

  // First check after 10s delay
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000)

  // Then every 4 hours
  checkInterval = setInterval(
    () => autoUpdater.checkForUpdates().catch(() => {}),
    4 * 60 * 60 * 1000,
  )
}

export function stopAutoUpdater(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

export function registerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('updates:check', async (): Promise<UpdateInfo> => {
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result) return { available: false }
      const { updateInfo } = result
      return {
        available: updateInfo.version !== app.getVersion(),
        version: updateInfo.version,
        releaseDate: updateInfo.releaseDate,
      }
    } catch {
      return { available: false }
    }
  })

  ipcMain.handle('updates:download', async () => {
    if (isDebInstall()) {
      await shell.openExternal('https://github.com/BaLaurent/agent-desktop/releases/latest')
      return
    }
    await autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updates:install', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updates:getStatus', (): UpdateStatus => {
    return lastStatus
  })
}
