import { BrowserWindow, screen, ipcMain } from 'electron'
import type { IpcMain } from 'electron'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { registerStreamWindow } from './streaming'
import { reregister } from './globalShortcuts'
import { getMainWindow } from '../index'
import { DEFAULT_MODEL } from '../../shared/constants'

let overlayWindow: BrowserWindow | null = null
let headlessActive = false
let db: Database.Database

// --- Conversation Management ---

function ensureConversation(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'quickChat_conversationId'").get() as { value: string } | undefined
  const existingId = row?.value ? Number(row.value) : 0

  if (existingId > 0) {
    // Verify conversation still exists
    const exists = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(existingId)
    if (exists) return existingId
  }

  // Create new Quick Chat conversation
  const modelRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_model'").get() as { value: string } | undefined
  const model = modelRow?.value || DEFAULT_MODEL

  const result = db.prepare(
    `INSERT INTO conversations (title, model, updated_at) VALUES (?, ?, datetime('now'))`
  ).run('Quick Chat', model)

  const newId = result.lastInsertRowid as number
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('quickChat_conversationId', ?, datetime('now'))").run(String(newId))

  // Notify main window to refresh conversation list so Quick Chat appears in sidebar
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('conversations:refresh')
  }

  return newId
}

function purgeConversation(): void {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'quickChat_conversationId'").get() as { value: string } | undefined
  const id = row?.value ? Number(row.value) : 0
  if (id > 0) {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
  }
}

// --- Overlay Window ---

function createOverlay(voice: boolean, headless = false): BrowserWindow {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const winW = 650
  const winH = voice ? 200 : 420
  const x = Math.round((screenW - winW) / 2)
  const y = Math.round(screenH * 0.2)

  const win = new BrowserWindow({
    width: winW,
    height: winH,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Load same renderer with overlay query param
  const base = process.env.ELECTRON_RENDERER_URL || 'file://' + join(__dirname, '../renderer/index.html')
  const sep = base.includes('?') ? '&' : '?'
  win.loadURL(`${base}${sep}mode=overlay&voice=${voice}&headless=${headless}`)

  if (!headless) {
    win.once('ready-to-show', () => win.show())
  }
  win.on('closed', () => { overlayWindow = null; headlessActive = false })

  registerStreamWindow(win)
  return win
}

export function showOverlay(mode: 'text' | 'voice'): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayWindow.isVisible() || headlessActive) {
      if (mode === 'voice') {
        overlayWindow.webContents.send('overlay:stopRecording')
      } else {
        overlayWindow.hide()
      }
      return
    }
    overlayWindow.destroy()
    overlayWindow = null
  }

  const isHeadless = mode === 'voice' &&
    (db.prepare("SELECT value FROM settings WHERE key = 'quickChat_voiceHeadless'")
      .get() as { value: string } | undefined)?.value === 'true'

  headlessActive = !!isHeadless
  overlayWindow = createOverlay(mode === 'voice', isHeadless)
}

export function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide()
  }
}

function setBubbleMode(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  overlayWindow.setBounds({ x: screenW - 420, y: screenH - 300, width: 400, height: 280 })
  overlayWindow.setAlwaysOnTop(true)
}

// --- IPC Handlers ---

export function registerHandlers(ipcMain: IpcMain, database: Database.Database): void {
  db = database

  ipcMain.handle('quickChat:getConversationId', () => ensureConversation())
  ipcMain.handle('quickChat:purge', () => purgeConversation())
  ipcMain.handle('quickChat:hide', () => hideOverlay())
  ipcMain.handle('quickChat:setBubbleMode', () => setBubbleMode())
  ipcMain.handle('quickChat:reregisterShortcuts', () => reregister())
}
