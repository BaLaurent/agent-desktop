import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { validateString } from '../utils/validate'
import { SETTING_DEFS, AI_OVERRIDE_KEYS } from '../../shared/constants'

// Whitelist of allowed setting keys — prevents arbitrary key writes from renderer
const ALLOWED_SETTING_KEYS = new Set<string>([
  // AI settings from SETTING_DEFS and AI_OVERRIDE_KEYS
  ...SETTING_DEFS.map((d) => d.key),
  ...AI_OVERRIDE_KEYS,
  // General settings
  'theme',
  'sendOnEnter',
  'autoScroll',
  'minimizeToTray',
  'notificationSounds',
  'notificationConfig',
  'notificationDesktopMode',
  'activeTheme',
  // Appearance
  'showTitlebar',
  'fontSize',
  'chatLayout',
  'panelButtonAlwaysVisible',
  'panelButtonRadius',
  // Whisper / voice
  'whisper_binaryPath',
  'whisper_modelPath',
  'whisper_advancedParams',
  'whisper_autoSend',
  // Quick Chat
  'quickChat_conversationId',
  'quickChat_voiceConversationId',
  'quickChat_separateVoiceConversation',
  'quickChat_responseNotification',
  'quickChat_responseBubble',
  'quickChat_voiceHeadless',
  // Global shortcuts
  'globalShortcut_quickChat',
  'globalShortcut_quickVoice',
  // HTML sandbox trust
  'html_jsTrustedFolders',
  'html_jsTrustAll',
  // CWD restriction
  'hooks_cwdRestriction',
])

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('settings:get', async () => {
    try {
      const rows = db.prepare('SELECT key, value FROM settings').all() as {
        key: string
        value: string
      }[]
      const result: Record<string, string> = {}
      for (const row of rows) {
        result[row.key] = row.value
      }
      return result
    } catch (err) {
      throw new Error(`Failed to get settings: ${(err as Error).message}`)
    }
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    try {
      validateString(key, 'key', 200)
      validateString(value, 'value', 10_000)
      if (!ALLOWED_SETTING_KEYS.has(key)) {
        throw new Error(`Unknown setting key: ${key}`)
      }
      db.prepare(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      ).run(key, value)
    } catch (err) {
      throw new Error(`Failed to set setting: ${(err as Error).message}`)
    }
  })
}
