import { BrowserWindow, screen, ipcMain } from 'electron'
import type { IpcMain } from 'electron'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { registerStreamWindow } from './streaming'
import { reregister } from './globalShortcuts'
import { getMainWindow } from '../index'
import { DEFAULT_MODEL } from '../../shared/constants'
import { duckVolume, restoreVolume } from '../utils/volume'

let overlayWindow: BrowserWindow | null = null
let headlessActive = false
let db: Database.Database

// --- Conversation Management ---

function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value || ''
}

function ensureConversation(mode?: 'text' | 'voice'): number {
  const separate = getSetting('quickChat_separateVoiceConversation') === 'true'
  const useVoiceKey = separate && mode === 'voice'
  const settingKey = useVoiceKey ? 'quickChat_voiceConversationId' : 'quickChat_conversationId'
  const title = useVoiceKey ? 'Quick Chat (Voice)' : 'Quick Chat'

  const existingId = Number(getSetting(settingKey)) || 0

  if (existingId > 0) {
    const exists = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(existingId)
    if (exists) return existingId
  }

  // Create new Quick Chat conversation
  const model = getSetting('ai_model') || DEFAULT_MODEL

  const result = db.prepare(
    `INSERT INTO conversations (title, model, updated_at) VALUES (?, ?, datetime('now'))`
  ).run(title, model)

  const newId = result.lastInsertRowid as number
  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(settingKey, String(newId))

  // Notify main window to refresh conversation list so Quick Chat appears in sidebar
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('conversations:refresh')
  }

  return newId
}

function purgeConversation(): void {
  const textId = Number(getSetting('quickChat_conversationId')) || 0
  if (textId > 0) {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(textId)
  }

  const voiceId = Number(getSetting('quickChat_voiceConversationId')) || 0
  if (voiceId > 0 && voiceId !== textId) {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(voiceId)
  }
}

// --- Overlay Window ---

function createOverlay(voice: boolean, headless = false): BrowserWindow {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const winW = voice ? 400 : 650
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

  const base = process.env.ELECTRON_RENDERER_URL || 'file://' + join(__dirname, '../renderer/index.html')
  const sep = base.includes('?') ? '&' : '?'
  const url = `${base}${sep}mode=overlay&voice=${voice}&headless=${headless}`

  // Use did-finish-load instead of ready-to-show — the latter never fires
  // for transparent windows on Linux/Wayland
  if (!headless) {
    win.webContents.once('did-finish-load', () => {
      win.show()
      win.focus()
    })
  }

  win.loadURL(url)
  win.on('closed', () => { overlayWindow = null; headlessActive = false; restoreVolume() })

  registerStreamWindow(win)
  return win
}

export function showOverlay(mode: 'text' | 'voice'): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (overlayWindow.isVisible() || headlessActive) {
      if (mode === 'voice') {
        overlayWindow.webContents.send('overlay:stopRecording')
        restoreVolume()
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

  if (mode === 'voice') {
    const duck = Number(getSetting('voice_volumeDuck')) || 0
    if (duck > 0) duckVolume(duck)
  }
}

export function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy()
    // 'closed' handler resets overlayWindow = null and headlessActive = false
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

  ipcMain.handle('quickChat:getConversationId', (_e, mode?: string) =>
    ensureConversation(mode === 'voice' ? 'voice' : 'text')
  )
  ipcMain.handle('quickChat:purge', () => purgeConversation())
  ipcMain.handle('quickChat:hide', () => hideOverlay())
  ipcMain.handle('quickChat:setBubbleMode', () => setBubbleMode())
  ipcMain.handle('quickChat:reregisterShortcuts', () => reregister())
}
