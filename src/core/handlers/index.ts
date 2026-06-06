import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import type { Broadcaster } from '../ports/broadcaster'
import type { HookRunner } from '../ports/hookRunner'
import type { SettingsService } from '../services/settings'
import { registerSettingsHandlers } from './settings'
import { registerFoldersHandlers } from './folders'
import { registerConversationsHandlers } from './conversations'
import { registerToolsHandlers } from './tools'
import { registerShortcutsHandlers } from './shortcuts'
import { registerMcpHandlers } from './mcp'
import { registerAuthHandlers } from './auth'
import { registerModelsHandlers } from './models'
import { registerAttachmentsHandlers } from './attachments'
import { registerMessagesHandlers } from './messages'
import { registerFilesHandlers } from './files'
import { registerThemesHandlers } from './themes'
import { registerCommandsHandlers } from './commands'
import { registerKnowledgeHandlers } from './knowledge'
import { registerSchedulerHandlers } from './scheduler'
import { registerTtsHandlers, speakResponse, stop as ttsStop } from './tts'
import { registerWhisperHandlers } from './whisper'
import { registerSherpaHandlers } from './sherpa'
import { registerVoiceIntentHandlers } from './voiceIntent'
import { registerSystemHandlers } from './system'
import { registerGitHandlers } from './git'
import { registerBugReportHandlers, type BugReportHandlerOptions } from './bugReport'
import { registerWebServerAuthHandlers } from './webServerAuth'
import { createLogger } from '../utils/logger'

const log = createLogger('messages')

interface CoreHandlerOptions {
  broadcaster: Broadcaster
  hookRunner: HookRunner
  sessionsBase: string
  themesDir: string
  knowledgesDir: string
  bugReport?: BugReportHandlerOptions
  webPassword: import('../auth').WebPasswordService
  settingsService?: SettingsService
}

export function registerCoreHandlers(
  registrar: HandleRegistrar,
  db: SqlJsAdapter,
  options: CoreHandlerOptions,
): void {
  registerSettingsHandlers(registrar, db, options.settingsService)
  registerFoldersHandlers(registrar, db)
  registerConversationsHandlers(registrar, db)
  registerToolsHandlers(registrar, db)
  registerShortcutsHandlers(registrar, db)
  registerMcpHandlers(registrar, db)
  registerAuthHandlers(registrar, db)
  registerModelsHandlers(registrar)
  registerAttachmentsHandlers(registrar, db)
  registerMessagesHandlers(registrar, db, {
    broadcaster: options.broadcaster,
    hookRunner: options.hookRunner,
    sessionsBase: options.sessionsBase,
    knowledgesDir: options.knowledgesDir,
    // Auto-fire TTS at end-of-stream. speakResponse honors per-conv aiSettings
    // (full / summary / auto / off), so off-providers no-op cleanly.
    onTtsSpeak: (content, convId, aiSettings) => {
      speakResponse(content, db, convId, aiSettings).catch(err =>
        log.error('auto-tts error', err))
    },
    onTtsStop: () => ttsStop(),
  })
  registerFilesHandlers(registrar, db, { sessionsBase: options.sessionsBase })
  registerThemesHandlers(registrar, options.themesDir)
  registerCommandsHandlers(registrar, db)
  registerKnowledgeHandlers(registrar, options.knowledgesDir)
  registerSchedulerHandlers(registrar, db)
  registerTtsHandlers(registrar, db)
  registerWhisperHandlers(registrar, db)
  registerSherpaHandlers(registrar, db)
  registerVoiceIntentHandlers(registrar, db, {
    sessionsBase: options.sessionsBase,
    knowledgesDir: options.knowledgesDir,
  })
  registerSystemHandlers(registrar, db)
  registerGitHandlers(registrar)
  if (options.bugReport) {
    registerBugReportHandlers(registrar, options.bugReport)
  }
  registerWebServerAuthHandlers(registrar, options.webPassword)
}
