import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { getDatabase, closeDatabase } from './db/database'
import { registerAllHandlers } from './ipc'
import { createTray, setTrayUpdateCallbacks, rebuildTrayMenu, toggleAppWindow } from './services/tray'
import { initAutoUpdater, stopAutoUpdater, checkForUpdates, installUpdate } from './services/updater'
import { setupDeepLinks } from './services/deeplink'
import { registerPreviewScheme, registerPreviewProtocol } from './services/protocol'
import { registerStreamWindow } from './services/streaming'
import { cleanupPastedFiles } from './services/files'
import { registerGlobalShortcuts, unregisterAll as unregisterGlobalShortcuts } from './services/globalShortcuts'
import { showOverlay } from './services/quickChat'

// Custom protocol — must be registered before app.ready
registerPreviewScheme()

// Enrich PATH/HOME for AppImage and non-standard environments — before GPU flags
// (enrichEnvironment discovers WAYLAND_DISPLAY which affects Ozone platform choice)
import { enrichEnvironment } from './utils/env'
enrichEnvironment()

// GPU flags — Linux only (Ozone/EGL/VAAPI are not available on macOS)
if (process.platform === 'linux') {
  // Force Wayland backend when a Wayland compositor is running.
  // 'auto' hint tries X11 first when DISPLAY is set (XWayland), which is wrong on Hyprland/Sway.
  if (process.env.WAYLAND_DISPLAY) {
    app.commandLine.appendSwitch('ozone-platform', 'wayland')
  } else {
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
  }
  app.commandLine.appendSwitch('use-gl', 'egl')
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecodeLinuxGL')
}

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
    cleanupPastedFiles().catch(() => {}) // fire-and-forget: remove stale paste temp files
    setupDeepLinks(app)
    createWindow()
    registerStreamWindow(mainWindow!)
    registerGlobalShortcuts(db, {
      onQuickChat: () => showOverlay('text'),
      onQuickVoice: () => showOverlay('voice'),
      onShowApp: () => toggleAppWindow(),
    })

    createTray(getMainWindow, createWindow)

    if (app.isPackaged) {
      setTrayUpdateCallbacks(checkForUpdates, installUpdate)
      initAutoUpdater(getMainWindow, () => rebuildTrayMenu(true))
    }
  }).catch((err) => {
    // dialog must be required inline — not available if app.ready fails
    const { dialog } = require('electron')
    console.error('[startup] Fatal:', err)
    dialog.showErrorBox('Startup Failed', err.message || String(err))
    app.quit()
  })

  app.on('before-quit', () => {
    unregisterGlobalShortcuts()
    stopAutoUpdater()
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
