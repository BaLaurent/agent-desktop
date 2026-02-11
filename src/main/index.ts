import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { getDatabase, closeDatabase } from './db/database'
import { registerAllHandlers } from './ipc'
import { createTray } from './services/tray'
import { setupDeepLinks } from './services/deeplink'
import { registerPreviewScheme, registerPreviewProtocol } from './services/protocol'

// Custom protocol — must be registered before app.ready
registerPreviewScheme()

// GPU flags — Linux only (Ozone/EGL/VAAPI are not available on macOS)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  app.commandLine.appendSwitch('use-gl', 'egl')
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecodeLinuxGL')
}

// Enrich PATH/HOME for AppImage and non-standard environments — before app.ready
import { enrichEnvironment } from './utils/env'
enrichEnvironment()

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// Window control IPC — registered once, use module-level mainWindow via closure
let windowIpcRegistered = false
function registerWindowIpc(): void {
  if (windowIpcRegistered) return
  windowIpcRegistered = true

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => {
    try {
      const db = getDatabase()
      const row = db.prepare("SELECT value FROM settings WHERE key = 'minimizeToTray'").get() as { value: string } | undefined
      if (row?.value === 'true') {
        mainWindow?.hide()
        return
      }
    } catch {
      // Fall through to close
    }
    mainWindow?.close()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required: electron-vite preload needs Node.js access for ipcRenderer
    },
  })

  registerWindowIpc()

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Request single instance lock for deep links
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    registerPreviewProtocol()
    const db = getDatabase()
    registerAllHandlers(ipcMain, db)
    setupDeepLinks(app)
    createWindow()

    createTray(getMainWindow, createWindow)
  })

  app.on('before-quit', () => {
    closeDatabase()
  })

  app.on('window-all-closed', () => {
    try {
      const db = getDatabase()
      const row = db.prepare("SELECT value FROM settings WHERE key = 'minimizeToTray'").get() as { value: string } | undefined
      if (row?.value === 'true') return
    } catch {
      // Fall through to quit
    }
    app.quit()
  })
}
