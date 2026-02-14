import { app, Tray, Menu, nativeImage, nativeTheme, BrowserWindow } from 'electron'
import * as path from 'path'
import { showOverlay } from './quickChat'

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

export function createTray(
  getWindow: () => BrowserWindow | null,
  ensureWindow: () => void,
): Tray {
  const tray = new Tray(loadTrayIcon())

  function showWindow(): void {
    let win = getWindow()
    if (!isAlive(win)) {
      ensureWindow()
      win = getWindow()
    }
    if (isAlive(win)) {
      win.show()
      win.focus()
    }
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: (): void => {
        const win = getWindow()
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
        const win = getWindow()
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
    {
      label: 'Quit',
      click: (): void => {
        const win = getWindow()
        if (isAlive(win)) win.destroy()
        app.quit()
      },
    },
  ])

  tray.setToolTip('Agent Desktop')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    const win = getWindow()
    if (isAlive(win) && win.isVisible()) {
      win.hide()
    } else {
      showWindow()
    }
  })

  // Swap icon when system theme changes (Linux/Windows)
  if (process.platform !== 'darwin') {
    nativeTheme.on('updated', () => {
      tray.setImage(loadTrayIcon())
    })
  }

  return tray
}
