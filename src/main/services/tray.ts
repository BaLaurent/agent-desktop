import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'
import * as path from 'path'

function isAlive(win: BrowserWindow | null): win is BrowserWindow {
  return win !== null && !win.isDestroyed()
}

function loadTrayIcon(): Electron.NativeImage {
  // In packaged app, files are in process.resourcesPath (via extraResources).
  // In dev, load from the project build/ directory.
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'trayTemplate.png')
    : path.join(app.getAppPath(), 'build', 'trayTemplate.png')
  const img = nativeImage.createFromPath(iconPath)
  // setTemplateImage makes macOS auto-adapt for light/dark menu bars
  img.setTemplateImage(true)
  return img
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

  return tray
}
