import type Database from 'better-sqlite3'
import { DEFAULT_MODEL, DEFAULT_EXCLUDE_PATTERNS, DEFAULT_NOTIFICATION_CONFIG } from '../../shared/constants'

export function seedDefaults(db: Database.Database): void {
  seedShortcuts(db)
  seedSettings(db)
}

function seedShortcuts(db: Database.Database): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO keyboard_shortcuts (action, keybinding, enabled) VALUES (?, ?, 1)'
  )

  const defaults: [string, string][] = [
    ['new_conversation', 'Ctrl+N'],
    ['send_message', 'Enter'],
    ['stop_generation', 'Escape'],
    ['toggle_sidebar', 'Ctrl+B'],
    ['toggle_panel', 'Ctrl+J'],
    ['focus_search', 'Ctrl+K'],
    ['settings', 'Ctrl+,'],
    ['voice_input', 'Ctrl+Shift+V'],
    ['cycle_permission_mode', 'Shift+Tab'],
    ['quick_chat', 'Alt+Space'],
    ['quick_voice', 'Alt+Shift+Space'],
    ['show_app', 'Super+A'],
  ]

  for (const [action, keybinding] of defaults) {
    insert.run(action, keybinding)
  }
}

function seedSettings(db: Database.Database): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  )

  const defaults: [string, string][] = [
    ['theme', 'dark'],
    ['sendOnEnter', 'true'],
    ['autoScroll', 'true'],
    ['notificationSounds', 'true'],
    ['minimizeToTray', 'false'],
    ['ai_model', DEFAULT_MODEL],
    ['ai_maxTurns', '50'],
    ['ai_maxThinkingTokens', '0'],
    ['ai_maxBudgetUsd', '0'],
    ['ai_defaultSystemPrompt', ''],
    ['ai_permissionMode', 'bypassPermissions'],
    ['ai_tools', 'preset:claude_code'],
    ['whisper_binaryPath', 'whisper-cli'],
    ['whisper_modelPath', ''],
    ['whisper_advancedParams', ''],
    ['whisper_autoSend', 'false'],
    ['hooks_cwdRestriction', 'true'],
    ['ai_skills', 'off'],
    ['ai_skillsEnabled', 'true'],
    ['ai_disabledSkills', '[]'],
    ['files_excludePatterns', DEFAULT_EXCLUDE_PATTERNS],
    ['notificationConfig', JSON.stringify(DEFAULT_NOTIFICATION_CONFIG)],
    ['notificationDesktopMode', 'unfocused'],
    ['globalShortcut_quickChat', 'Alt+Space'],
    ['globalShortcut_quickVoice', 'Alt+Shift+Space'],
    ['quickChat_conversationId', ''],
    ['quickChat_voiceConversationId', ''],
    ['quickChat_separateVoiceConversation', 'false'],
    ['quickChat_responseNotification', 'true'],
    ['quickChat_responseBubble', 'true'],
    ['quickChat_voiceHeadless', 'false'],
  ]

  for (const [key, value] of defaults) {
    insert.run(key, value)
  }
}
