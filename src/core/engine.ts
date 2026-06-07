import { join } from 'path'
import { homedir } from 'os'
import { TypedEventEmitter } from './events'
import { initDatabase, getDatabase, closeDatabase } from './db/database'
import type { SqlJsAdapter } from './db/sqljs-adapter'
import { SettingsService } from './services/settings'
import { ConversationService } from './services/conversations'
import { SchedulerService } from './services/scheduler'
import { createWebPasswordService, type WebPasswordService } from './auth'
import { DispatchRegistry } from './dispatch'
import { registerCoreHandlers } from './handlers'
import type { BugReportHandlerOptions } from './handlers/bugReport'
import type { Broadcaster } from './ports/broadcaster'
import type { HookRunner } from './ports/hookRunner'
import { noopHookRunner } from './ports/hookRunner'
import type { PlatformIO } from './ports/platformIO'
import { noopPlatformIO } from './ports/platformIO'
import type { SystemUI } from './ports/systemUI'
import { noopSystemUI } from './ports/systemUI'
import type {
  StreamChunk,
  JupyterOutputChunk,
  ScheduledTask,
  UpdateStatus,
} from './types'

// ─── Engine Events ─────────────────────────────────────────
// These replace the 12 one-way webContents.send() broadcast channels.
// Adapters subscribe and forward to their transport.

type EngineEvents = {
  'stream:chunk':              [conversationId: number, chunk: StreamChunk]
  'conversation:updated':      [conversationId: number]
  'conversation:titleUpdated': [id: number, title: string]
  'conversations:refresh':     []
  'tts:stateChange':           [state: { speaking: boolean; messageId?: number }]
  'jupyter:output':            [chunk: JupyterOutputChunk]
  'scheduler:taskUpdate':      [task: ScheduledTask]
  'updates:status':            [status: UpdateStatus]
  'theme:autoSwitch':          [filename: string]
  'tray:newConversation':      []
  'deeplink:navigate':         [conversationId: number]
  'overlay:stopRecording':     []
}

// ─── Engine Options ────────────────────────────────────────

interface EngineOptions {
  dbPath: string
  wasmPath?: string
  themesDir: string
  broadcaster: Broadcaster
  platformIO?: PlatformIO
  systemUI?: SystemUI
  hookRunner?: HookRunner
  bugReport?: BugReportHandlerOptions
}

// ─── Agent Engine ──────────────────────────────────────────

export class AgentEngine extends TypedEventEmitter<EngineEvents> {
  readonly broadcaster: Broadcaster
  readonly platformIO: PlatformIO
  readonly systemUI: SystemUI
  readonly hookRunner: HookRunner
  readonly dispatch: DispatchRegistry

  // Services (initialized after DB is ready)
  private _settings!: SettingsService
  private _conversations!: ConversationService
  private _scheduler!: SchedulerService
  private _webPassword!: WebPasswordService

  private readonly dbPath: string
  private readonly wasmPath?: string
  private readonly themesDir: string
  private readonly bugReportOpts?: BugReportHandlerOptions

  constructor(options: EngineOptions) {
    super()
    this.dbPath = options.dbPath
    this.wasmPath = options.wasmPath
    this.themesDir = options.themesDir
    this.broadcaster = options.broadcaster
    this.platformIO = options.platformIO ?? noopPlatformIO
    this.systemUI = options.systemUI ?? noopSystemUI
    this.hookRunner = options.hookRunner ?? noopHookRunner
    this.bugReportOpts = options.bugReport
    this.dispatch = new DispatchRegistry()
  }

  /** Get the database instance (throws if not initialized) */
  get db(): SqlJsAdapter {
    return getDatabase()
  }

  get settings(): SettingsService { return this._settings }
  get conversations(): ConversationService { return this._conversations }
  get scheduler(): SchedulerService { return this._scheduler }
  get webPassword(): WebPasswordService { return this._webPassword }

  async init(): Promise<void> {
    await initDatabase(this.dbPath, this.wasmPath)
    const db = getDatabase() as any
    this._settings = new SettingsService(db)
    this._conversations = new ConversationService(db)
    this._scheduler = new SchedulerService(db)
    this._webPassword = createWebPasswordService({
      get: (k) => {
        const all = this._settings.getAll()
        return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : undefined
      },
      set: (k, v) => this._settings.set(k, v),
      delete: (k) => { this._settings.set(k, '') },
    })
    registerCoreHandlers(this.dispatch, db, {
      broadcaster: this.broadcaster,
      hookRunner: this.hookRunner,
      sessionsBase: join(homedir(), '.agent-desktop', 'sessions-folder'),
      themesDir: this.themesDir,
      knowledgesDir: join(homedir(), '.agent-desktop', 'knowledges'),
      bugReport: this.bugReportOpts,
      webPassword: this._webPassword,
      settingsService: this._settings,
    })
  }

  async shutdown(): Promise<void> {
    // Phase 3+ will wire: session shutdown, scheduler stop, etc.
    closeDatabase()
    this.removeAllListeners()
  }
}
