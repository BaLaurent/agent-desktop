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
import { registerGuidesHandlers } from './guides'
import { registerKnowledgeHandlers } from './knowledge'
import { registerSchedulerHandlers } from './scheduler'
import { registerJupyterHandlers } from './jupyter'
import { registerTtsHandlers, speakResponse, stop as ttsStop } from './tts'
import { registerWhisperHandlers } from './whisper'
import { registerSherpaHandlers } from './sherpa'
import { registerOpenscadHandlers } from './openscad'
import { registerVoiceIntentHandlers } from './voiceIntent'
import { registerSystemHandlers } from './system'
import { registerGitHandlers } from './git'
import { registerBugReportHandlers, type BugReportHandlerOptions } from './bugReport'
import { registerWebServerAuthHandlers } from './webServerAuth'
import { registerPIExtensionsHandlers } from './piExtensions'
import { createLogger } from '../utils/logger'
import { join } from 'path'

/**
 * Filesystem path to the bundled Jupyter Python bridge script. The
 * Electron main process resolves this against `app.getAppPath()` /
 * `process.resourcesPath` and threads the result via
 * `CoreHandlerOptions.jupyterBridgePath`; if the caller does not
 * supply one (e.g. headless), we fall back to `resources/jupyter/bridge.py`
 * relative to `process.cwd()`. The actual path is only used when a
 * Jupyter channel is invoked, so an incorrect fallback is harmless
 * until then.
 */
export function defaultJupyterBridgePath(): string {
  return process.env.AGENT_JUPYTER_BRIDGE_PATH || join(process.cwd(), 'resources', 'jupyter', 'bridge.py')
}
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
  /** Filesystem path to the Python bridge script (`resources/jupyter/bridge.py`). */
  jupyterBridgePath?: string
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
  registerGuidesHandlers(registrar, db)
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
  registerOpenscadHandlers(registrar, db)
  registerWebServerAuthHandlers(registrar, options.webPassword)
  registerPIExtensionsHandlers(registrar)
  registerJupyterHandlers(registrar, { bridgeScriptPath: options.jupyterBridgePath ?? defaultJupyterBridgePath() })
}
