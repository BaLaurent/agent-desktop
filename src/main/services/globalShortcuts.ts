import { globalShortcut, app } from 'electron'
import type Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { getSessionType } from '../utils/env'
import { registerWaylandShortcuts, rebindWaylandShortcuts, unregisterWaylandShortcuts } from './waylandShortcuts'

interface ShortcutCallbacks {
  onQuickChat: () => void
  onQuickVoice: () => void
  onShowApp: () => void
}

let db: Database.Database
let callbacks: ShortcutCallbacks
let sessionType: 'wayland' | 'x11' | 'unknown'
let waylandActive = false

/** Append a timestamped line to ~/.config/agent-desktop/shortcuts.log for debugging */
function logToFile(msg: string): void {
  try {
    const logDir = path.join(app.getPath('userData'))
    const logPath = path.join(logDir, 'shortcuts.log')
    const line = `[${new Date().toISOString()}] ${msg}\n`
    fs.appendFileSync(logPath, line)
  } catch {
    // best effort
  }
}

function readShortcutKeybinding(action: string): string | undefined {
  const row = db.prepare('SELECT keybinding FROM keyboard_shortcuts WHERE action = ? AND enabled = 1').get(action) as { keybinding: string } | undefined
  return row?.keybinding || undefined
}

export function registerGlobalShortcuts(database: Database.Database, cbs: ShortcutCallbacks): void {
  db = database
  callbacks = cbs
  sessionType = getSessionType()
  console.log('[globalShortcuts] Session type:', sessionType)
  logToFile(`Session type: ${sessionType}`)
  logToFile(`Env: DBUS=${process.env.DBUS_SESSION_BUS_ADDRESS || '(unset)'} WAYLAND=${process.env.WAYLAND_DISPLAY || '(unset)'} XDG_SESSION=${process.env.XDG_SESSION_TYPE || '(unset)'} HYPRLAND_SIG=${process.env.HYPRLAND_INSTANCE_SIGNATURE || '(unset)'}`)
  reregister().catch((err) => {
    console.error('[globalShortcuts] Failed to register shortcuts:', err)
    logToFile(`FAILED: ${err}`)
  })
}

let reregisterLock: Promise<void> | null = null

export async function reregister(): Promise<void> {
  if (reregisterLock) await reregisterLock
  reregisterLock = doReregister().finally(() => { reregisterLock = null })
  return reregisterLock
}

async function doReregister(): Promise<void> {
  const chatKey = readShortcutKeybinding('quick_chat') || 'Alt+Space'
  const voiceKey = readShortcutKeybinding('quick_voice') || 'Alt+Shift+Space'
  const showKey = readShortcutKeybinding('show_app') || 'Super+A'

  if (sessionType === 'wayland') {
    // Fast path: if session already active, just rebind hyprctl keys (no D-Bus teardown).
    // The portal session and Activated listener stay intact — only the key combos change.
    if (waylandActive) {
      logToFile(`Rebinding Wayland shortcuts (session alive): chat=${chatKey} voice=${voiceKey} show=${showKey}`)
      const ok = await rebindWaylandShortcuts([
        { id: 'quick-chat', accelerator: chatKey },
        { id: 'quick-voice', accelerator: voiceKey },
        { id: 'show-app', accelerator: showKey },
      ])
      if (ok) {
        logToFile('Wayland rebind OK')
        return
      }
      // Session gone — fall through to full registration
      logToFile('Wayland rebind failed (session lost), doing full re-registration')
      waylandActive = false
    }

    logToFile(`Registering Wayland shortcuts: chat=${chatKey} voice=${voiceKey} show=${showKey}`)
    const ok = await registerWaylandShortcuts(
      [
        { id: 'quick-chat', accelerator: chatKey, description: 'Quick Chat' },
        { id: 'quick-voice', accelerator: voiceKey, description: 'Quick Voice' },
        { id: 'show-app', accelerator: showKey, description: 'Show App' },
      ],
      (shortcutId) => {
        logToFile(`Activated: ${shortcutId}`)
        if (shortcutId === 'quick-chat') callbacks.onQuickChat()
        if (shortcutId === 'quick-voice') callbacks.onQuickVoice()
        if (shortcutId === 'show-app') callbacks.onShowApp()
      }
    )
    waylandActive = ok
    logToFile(`Wayland registration result: ${ok}`)
    if (!ok) {
      console.warn('[globalShortcuts] Wayland portal unavailable — global shortcuts disabled')
      logToFile('Wayland portal unavailable — global shortcuts disabled')
    }
  } else {
    // X11 path — must unregister all before re-registering
    globalShortcut.unregisterAll()
    try {
      globalShortcut.register(chatKey, callbacks.onQuickChat)
    } catch (e) {
      console.warn('[globalShortcuts] Failed to register', chatKey, e)
    }
    try {
      globalShortcut.register(voiceKey, callbacks.onQuickVoice)
    } catch (e) {
      console.warn('[globalShortcuts] Failed to register', voiceKey, e)
    }
    try {
      globalShortcut.register(showKey, callbacks.onShowApp)
    } catch (e) {
      console.warn('[globalShortcuts] Failed to register', showKey, e)
    }
  }
}

export async function unregisterAll(): Promise<void> {
  if (waylandActive) {
    await unregisterWaylandShortcuts()
    waylandActive = false
  }
  globalShortcut.unregisterAll()
}
