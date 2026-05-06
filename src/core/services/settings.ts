import type Database from 'better-sqlite3'
import { validateString } from '../utils/validate'
import { SETTING_DEFS, AI_OVERRIDE_KEYS } from '../types/constants'

// Whitelist of allowed setting keys — prevents arbitrary key writes
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
  'windowTitle',
  'showTitlebar',
  'fontSize',
  'chatLayout',
  'panelButtonAlwaysVisible',
  'panelButtonRadius',
  'heatmap_enabled',
  'heatmap_mode',
  'heatmap_min',
  'heatmap_max',
  // Auto day/night theme
  'autoTheme_enabled',
  'autoTheme_dayTheme',
  'autoTheme_nightTheme',
  'autoTheme_dayTime',
  'autoTheme_nightTime',
  // Whisper / voice
  'whisper_binaryPath',
  'whisper_modelPath',
  'whisper_advancedParams',
  'whisper_autoSend',
  // Voice ducking
  'voice_volumeDuck',
  // Quick Chat
  'quickChat_conversationId',
  'quickChat_voiceConversationId',
  'quickChat_separateVoiceConversation',
  'quickChat_responseNotification',
  'quickChat_responseBubble',
  'quickChat_voiceHeadless',
  'quickChat_resumeLastConversationText',
  'quickChat_resumeLastConversationVoice',
  'quickChat_resumePreferLastOpened',
  // Global shortcuts
  'globalShortcut_quickChat',
  'globalShortcut_quickVoice',
  // HTML sandbox trust
  'html_jsTrustedFolders',
  'html_jsTrustAll',
  // CWD restriction
  'hooks_cwdRestriction',
  'hooks_cwdWhitelist',
  // Streaming timeout
  'streamingTimeoutSeconds',
  // API Key auth (global only, not cascadable)
  'ai_apiKey',
  'ai_baseUrl',
  'ai_customModel',
  'ai_customModels',
  'ai_customModelContextLengths',
  'ai_contextTokenCounter',
  // AI behavior (global, not cascadable)
  'ai_compactModel',
  'ai_titleModel',
  // TTS settings (global, not cascadable)
  'tts_provider',
  'tts_piperUrl',
  'tts_edgettsVoice',
  'tts_edgettsBinary',
  'tts_sayVoice',
  'tts_playerPath',
  'tts_maxLength',
  'tts_autoWordLimit',
  'tts_summaryPrompt',
  'tts_responseMode',
  'tts_summaryModel',
  // Web server
  'server_enabled',
  'server_port',
  'server_autoStart',
  'server_shortCode',
  'server_accessMode',
  // Web server password auth
  'server_passwordHash',
  'server_sessionSecret',
  'server_sessionDurationDays',
  'server_rememberDurationDays',
  // Discord bot
  'discord_enabled',
  'discord_botToken',
  'discord_userWhitelist',
  'discord_channelBindings',
  // Retry settings (global only, not cascadable)
  'retry_enabled',
  'retry_maxAttempts',
  'retry_initialDelayMs',
  // Sort preferences (global only, not cascadable)
  'sort_criterion',
  'sort_direction',
  // Background scheduler (global only)
  'scheduler_background_enabled',
])

export class SettingsService {
  // Runtime lock for keys overridden at process startup (e.g. CLI --port).
  // Not persisted: the lock disappears on restart, matching the lifecycle
  // of the override that produced it.
  private readonly lockedKeys = new Set<string>()

  constructor(private db: Database.Database) {}

  getAll(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const result: Record<string, string> = {}
    for (const row of rows) {
      result[row.key] = row.value
    }
    return result
  }

  set(key: string, value: string): void {
    validateString(key, 'key', 200)
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      throw new Error(`Unknown setting key: ${key}`)
    }
    if (this.lockedKeys.has(key)) {
      throw new Error(`Setting '${key}' is locked by CLI override`)
    }
    if (value === '') {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
      return
    }
    validateString(value, 'value', 10_000)
    this.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    ).run(key, value)
  }

  lockKey(key: string): void {
    this.lockedKeys.add(key)
  }

  isLocked(key: string): boolean {
    return this.lockedKeys.has(key)
  }

  getLockedKeys(): string[] {
    return Array.from(this.lockedKeys).sort()
  }
}
