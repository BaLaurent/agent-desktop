import { app, Tray, Menu, nativeImage, nativeTheme, BrowserWindow } from 'electron'
import * as path from 'path'
import { showOverlay } from './quickChat'

let trayInstance: Tray | null = null
let getWindowFn: (() => BrowserWindow | null) | null = null
let ensureWindowFn: (() => void) | null = null
let updateReadyFlag = false
let onCheckUpdateFn: (() => void) | null = null
let onInstallUpdateFn: (() => void) | null = null

function isAlive(win: BrowserWindow | null): win is BrowserWindow {
  return win !== null && !win.isDestroyed()
}

function trayIconPath(filename: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, filename)
    : path.join(app.getAppPath(), 'build', filename)
}

function loadTrayIcon(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    // macOS: template image auto-adapts for light/dark menu bars
    const img = nativeImage.createFromPath(trayIconPath('trayTemplate.png'))
    img.setTemplateImage(true)
    return img
  }
  // Linux/Windows: pick icon variant based on system theme
  const filename = nativeTheme.shouldUseDarkColors ? 'trayLight.png' : 'trayDark.png'
  return nativeImage.createFromPath(trayIconPath(filename))
}

function showWindow(): void {
  let win = getWindowFn?.() ?? null
  if (!isAlive(win)) {
    ensureWindowFn?.()
    win = getWindowFn?.() ?? null
  }
  if (isAlive(win)) {
    win.show()
    win.focus()
  }
}

function buildContextMenu(): Menu {
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Show/Hide',
      click: (): void => {
        const win = getWindowFn?.() ?? null
        if (isAlive(win) && win.isVisible()) {
          win.hide()
        } else {
          showWindow()
        }
      },
    },
    {
      label: 'New Conversation',
      click: (): void => {
        showWindow()
        const win = getWindowFn?.() ?? null
        if (isAlive(win)) {
          win.webContents.send('tray:newConversation')
        }
      },
    },
    {
      label: 'Quick Chat',
      click: (): void => showOverlay('text'),
    },
    { type: 'separator' },
  ]

  // Update menu items (only when callbacks are wired)
  if (onCheckUpdateFn || onInstallUpdateFn) {
    if (updateReadyFlag && onInstallUpdateFn) {
      items.push({
        label: 'Restart to Update',
        click: (): void => onInstallUpdateFn?.(),
      })
    } else if (onCheckUpdateFn) {
      items.push({
        label: 'Check for Updates',
        click: (): void => onCheckUpdateFn?.(),
      })
    }
    items.push({ type: 'separator' })
  }

  items.push({
    label: 'Quit',
    click: (): void => {
      const win = getWindowFn?.() ?? null
      if (isAlive(win)) win.destroy()
      app.quit()
    },
  })

  return Menu.buildFromTemplate(items)
}

export function setTrayUpdateCallbacks(
  onCheckUpdate: () => void,
  onInstallUpdate: () => void,
): void {
  onCheckUpdateFn = onCheckUpdate
  onInstallUpdateFn = onInstallUpdate
  // Rebuild to include update menu items
  if (trayInstance) {
    trayInstance.setContextMenu(buildContextMenu())
  }
}

export function rebuildTrayMenu(updateReady: boolean): void {
  updateReadyFlag = updateReady
  if (trayInstance) {
    trayInstance.setContextMenu(buildContextMenu())
  }
}

export function createTray(
  getWindow: () => BrowserWindow | null,
  ensureWindow: () => void,
): Tray {
  getWindowFn = getWindow
  ensureWindowFn = ensureWindow

  trayInstance = new Tray(loadTrayIcon())
  trayInstance.setToolTip('Agent Desktop')
  trayInstance.setContextMenu(buildContextMenu())

  trayInstance.on('click', () => {
    const win = getWindowFn?.() ?? null
    if (isAlive(win) && win.isVisible()) {
      win.hide()
    } else {
      showWindow()
    }
  })

  // Swap icon when system theme changes (Linux/Windows)
  if (process.platform !== 'darwin') {
    nativeTheme.on('updated', () => {
      trayInstance?.setImage(loadTrayIcon())
    })
  }

  return trayInstance
}
