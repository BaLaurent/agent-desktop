import { globalShortcut } from 'electron'
import type Database from 'better-sqlite3'
import { getSessionType } from '../utils/env'
import { registerWaylandShortcuts, unregisterWaylandShortcuts } from './waylandShortcuts'

interface ShortcutCallbacks {
  onQuickChat: () => void
  onQuickVoice: () => void
}

let db: Database.Database
let callbacks: ShortcutCallbacks
let sessionType: 'wayland' | 'x11' | 'unknown'
let waylandActive = false

function readShortcutKeybinding(action: string): string | undefined {
  const row = db.prepare('SELECT keybinding FROM keyboard_shortcuts WHERE action = ? AND enabled = 1').get(action) as { keybinding: string } | undefined
  return row?.keybinding || undefined
}

export function registerGlobalShortcuts(database: Database.Database, cbs: ShortcutCallbacks): void {
  db = database
  callbacks = cbs
  sessionType = getSessionType()
  console.log('[globalShortcuts] Session type:', sessionType)
  reregister()
}

export async function reregister(): Promise<void> {
  // Clean up previous registrations
  if (waylandActive) {
    await unregisterWaylandShortcuts()
    waylandActive = false
  } else {
    globalShortcut.unregisterAll()
  }

  const chatKey = readShortcutKeybinding('quick_chat') || 'Alt+Space'
  const voiceKey = readShortcutKeybinding('quick_voice') || 'Alt+Shift+Space'

  if (sessionType === 'wayland') {
    const ok = await registerWaylandShortcuts(
      [
        { id: 'quick-chat', accelerator: chatKey, description: 'Quick Chat' },
        { id: 'quick-voice', accelerator: voiceKey, description: 'Quick Voice' },
      ],
      (shortcutId) => {
        if (shortcutId === 'quick-chat') callbacks.onQuickChat()
        if (shortcutId === 'quick-voice') callbacks.onQuickVoice()
      }
    )
    waylandActive = ok
    if (!ok) {
      console.warn('[globalShortcuts] Wayland portal unavailable — global shortcuts disabled')
    }
  } else {
    // X11 path (existing behavior)
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
  }
}

export async function unregisterAll(): Promise<void> {
  if (waylandActive) {
    await unregisterWaylandShortcuts()
    waylandActive = false
  }
  globalShortcut.unregisterAll()
}
