import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'

// 16x16 purple square PNG as data URL
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVQ4y2NkYPj/n4EKgJGqpg8aNGDQgEEDBgIAAIYEEAHvMJTqAAAAAElFTkSuQmCC'

function isAlive(win: BrowserWindow | null): win is BrowserWindow {
  return win !== null && !win.isDestroyed()
}

export function createTray(
  getWindow: () => BrowserWindow | null,
  ensureWindow: () => void,
): Tray {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  const tray = new Tray(icon)

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
