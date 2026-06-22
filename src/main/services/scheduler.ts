import type { IpcMain } from 'electron'
import type { SqlJsAdapter } from '../../core/db/sqljs-adapter'
import type { MessagesHandlerOptions } from '../../core/handlers/messages'
import { Notification } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { getMainWindow } from '../mainContext'
import {
  buildMessageHistory,
  getAISettings,
  getSystemPrompt,
  saveMessage,
  compactConversation as compactConversationImpl,
} from '../../core/handlers/messages'
import { noopHookRunner } from '../../core/ports/hookRunner'
import { getKnowledgesDir, getSupportedExtensions } from './knowledge'
import { getSchedulerMcpConfig } from './schedulerBridge'
import { streamMessage, injectApiKeyEnv, registerStreamWindow } from './streaming'
import { invalidateSession } from './sessionManager'
import { broadcast } from '../utils/broadcast'
import { speak as ttsSpeak, speakResponse } from './tts'
import {
  SchedulerService,
} from '../../core/services/scheduler'
import { executeTask as coreExecuteTask } from '../../core/services/taskExecutor'
import type { TaskRunContext } from '../../core/services/taskExecutor'
import type { ScheduledTask } from '../../core/types'
import { createPlatformScheduler } from './platformScheduler'
import { findBinaryInPath } from '../utils/env'
import { getBackgroundSchedulerEnabled } from '../../core/db/queries'
import { createLogger } from '../../core/utils/logger'

const log = createLogger('scheduler')

// Re-export core functions for backward compatibility with existing importers
export { computeNextRun, getExpectedThemeFilename } from '../../core/services/scheduler'

let tickInterval: ReturnType<typeof setInterval> | null = null
let schedulerService: SchedulerService | null = null
let schedulerDb: SqlJsAdapter | null = null

const HEADLESS_DIR = join(homedir(), '.config', 'agent-desktop', 'headless')

// ─── Electron TaskRunContext ───────────────────────────────

function notifyRenderer(event: string, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(event, data)
  }
  broadcast(event, data)
}

export function createElectronContext(db: SqlJsAdapter): TaskRunContext {
  const messagesOpts: MessagesHandlerOptions = {
    broadcaster: { broadcast },
    hookRunner: noopHookRunner,
    sessionsBase: join(homedir(), '.agent-desktop', 'sessions-folder'),
    knowledgesDir: getKnowledgesDir(),
    supportedKnowledgeExts: getSupportedExtensions(),
    getSchedulerMcpConfig,
    onSessionInvalidate: invalidateSession,
  }
  return {
    db: db as any,
    buildHistory(conversationId: number) {
      return buildMessageHistory(db, conversationId)
    },
    getAISettings(conversationId: number) {
      return getAISettings(db, conversationId, {
        sessionsBase: messagesOpts.sessionsBase,
        knowledgesDir: messagesOpts.knowledgesDir,
        getSchedulerMcpConfig: messagesOpts.getSchedulerMcpConfig,
      })
    },
    async getSystemPrompt(conversationId: number, cwd: string) {
      return getSystemPrompt(db, conversationId, cwd, {
        knowledgesDir: messagesOpts.knowledgesDir,
        supportedKnowledgeExts: messagesOpts.supportedKnowledgeExts,
        getSchedulerMcpConfig: messagesOpts.getSchedulerMcpConfig,
      })
    },
    async streamMessage(history, systemPrompt, aiSettings, conversationId) {
      // Inject API key env if configured
      const restoreEnv = injectApiKeyEnv(aiSettings.apiKey, aiSettings.baseUrl)

      // Ensure main window is registered for streaming
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        registerStreamWindow(win)
      }

      try {
        return await streamMessage(history, systemPrompt, aiSettings, conversationId)
      } finally {
        restoreEnv?.()
      }
    },
    saveMessage(conversationId, role, content, attachments?, toolCalls?) {
      saveMessage(db, conversationId, role as 'user' | 'assistant', content, attachments as any, toolCalls)
    },
    async notify(title, body) {
      try {
        new Notification({ title, body }).show()
      } catch { /* notification may fail in some environments */ }
    },
    onTaskUpdate(task: ScheduledTask) {
      notifyRenderer('scheduler:taskUpdate', task)
    },
    onConversationsRefresh() {
      notifyRenderer('conversations:refresh', undefined)
    },
    clearConversation(conversationId: number) {
      // Step back 1ms so the user message saved immediately after passes the strict `created_at > cleared_at` filter
      const clearedAt = new Date(Date.now() - 1).toISOString()
      db.prepare(
        'UPDATE conversations SET cleared_at = ?, compact_summary = NULL, sdk_session_id = NULL, pi_session_file = NULL, updated_at = ? WHERE id = ?'
      ).run(clearedAt, clearedAt, conversationId)
      // Explicit invalidation mirrors compactConversation's behaviour — both paths
      // must tear down the live SDK session so the next turn starts fresh.
      invalidateSession(conversationId)
    },
    async compactConversation(conversationId: number) {
      await compactConversationImpl(db, conversationId, messagesOpts)
    },
  }
}

// ─── Task execution (backward-compatible wrapper) ──────────

export async function executeTask(db: SqlJsAdapter, task: ScheduledTask): Promise<void> {
  if (!schedulerService || schedulerDb !== db) {
    schedulerDb = db
    schedulerService = new SchedulerService(db as any)
  }
  const ctx = createElectronContext(db)

  await coreExecuteTask(schedulerService, ctx, task)

  // Voice notification (TTS) — Electron-only, not in core
  if (task.notify_voice) {
    const updated = schedulerService.get(task.id)
    if (updated?.last_status === 'success') {
      // Speak the assistant's actual response (last assistant message in the
      // task's target conversation). Honors the cascade tts_responseMode
      // (full / summary / auto / off) per-conv aiSettings via speakResponse.
      const targetConvId = updated.conversation_id
      try {
        const lastMsg = (db as any).prepare(
          "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1"
        ).get(targetConvId) as { content: string } | undefined
        if (lastMsg?.content) {
          const aiSettings = ctx.getAISettings(targetConvId)
          speakResponse(lastMsg.content, db, targetConvId, aiSettings).catch(err =>
            log.error('voice notification error', err))
        }
      } catch (err) {
        log.error('failed to fetch last assistant message for TTS', err)
      }
    } else {
      // On failure, keep a short audible cue so the user knows.
      ttsSpeak('Task failed', db).catch(err =>
        log.error('voice notification error', err))
    }
  }
}

/** Backward-compatible reassignOrphanedTasks for existing callers (conversations.ts) */
export function reassignOrphanedTasks(db: SqlJsAdapter, conversationId: number): void {
  if (!schedulerService || schedulerDb !== db) {
    schedulerDb = db
    schedulerService = new SchedulerService(db as any)
  }
  schedulerService.reassignOrphanedTasks(conversationId)
}

// ─── Scheduler engine ──────────────────────────────────────

function tick(): void {
  if (!schedulerService || !schedulerDb) return

  // Auto-theme check
  const themeChange = schedulerService.checkAutoTheme()
  if (themeChange) {
    notifyRenderer('theme:autoSwitch', themeChange)
  }

  // Get due tasks and execute
  const dueTasks = schedulerService.getDueTasks()
  for (const task of dueTasks) {
    executeTask(schedulerDb, task).catch((err) => {
      log.error('unexpected error in task', err, { taskId: task.id })
    })
  }
}

export async function startScheduler(db: SqlJsAdapter): Promise<void> {
  schedulerDb = db
  schedulerService = new SchedulerService(db as any)

  // The desktop process is always a full read-write owner of agent.db (sql.js
  // loads the whole file into RAM and rewrites it wholesale on flush). So it
  // MUST run the tick whenever it's open — otherwise two writers (this process
  // + the headless OS-timer runner) would silently clobber each other's
  // snapshots. The headless runner stands down while this process is alive
  // (it checks the SingletonLock), so there is no double execution.
  schedulerService.recoverStuckTasks()
  schedulerService.recomputeMissedRuns()

  // Auto-theme: check on startup
  const themeChange = schedulerService.checkAutoTheme()
  if (themeChange) {
    notifyRenderer('theme:autoSwitch', themeChange)
  }

  // 1-minute tick resolution
  tickInterval = setInterval(tick, 60_000)

  const taskCount = schedulerService.list().filter(t => t.enabled).length

  // Background mode ADDITIONALLY installs an OS timer so tasks still fire when
  // the desktop is closed. While the desktop is alive the OS timer defers to it.
  const backgroundMode = getBackgroundSchedulerEnabled(db)
  if (backgroundMode) {
    log.info('background mode — in-memory tick active, OS timer installed as closed-app fallback', { taskCount })
    verifyPlatformScheduler(db).catch(err =>
      log.error('platform scheduler verification failed', err)
    )
  } else {
    log.info('standard mode — in-memory tick active', { taskCount })
  }
}

export async function stopScheduler(): Promise<void> {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
  schedulerService = null
  schedulerDb = null
  log.info('stopped')
}

// ─── Platform scheduler management ─────────────────────────

/** Extract headless script to stable path and install/verify OS scheduler */
async function verifyPlatformScheduler(db: SqlJsAdapter): Promise<void> {
  if (!getBackgroundSchedulerEnabled(db)) return

  const platformScheduler = createPlatformScheduler()

  // Find node executable
  const nodePath = findBinaryInPath('node') ?? process.execPath
  if (!nodePath) {
    log.warn('cannot find node binary — platform scheduler not installed')
    return
  }

  // Extract headless script + WASM to stable location
  const scriptPath = join(HEADLESS_DIR, 'taskRunner.js')
  try {
    const { app } = await import('electron')
    const isPackaged = app.isPackaged

    // Source is the unified headless bundle (index.js); destination keeps
    // the legacy filename (taskRunner.js) so existing cron entries still resolve.
    const scriptSource = isPackaged
      ? join(process.resourcesPath, 'headless', 'taskRunner.js')
      : join(app.getAppPath(), 'out', 'headless', 'index.js')
    const wasmSource = isPackaged
      ? join(process.resourcesPath, 'sql-wasm.wasm')
      : join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')

    await fsp.mkdir(HEADLESS_DIR, { recursive: true })
    await fsp.copyFile(scriptSource, scriptPath)
    await fsp.copyFile(wasmSource, join(HEADLESS_DIR, 'sql-wasm.wasm'))

    // Symlink node_modules so the headless runner can resolve @anthropic-ai/claude-agent-sdk
    // (ESM import() resolves relative to the file, so NODE_PATH alone isn't enough)
    const nodeModulesPath = isPackaged
      ? join(process.resourcesPath, 'app', 'node_modules')
      : join(app.getAppPath(), 'node_modules')
    const symlinkTarget = join(HEADLESS_DIR, 'node_modules')
    try {
      const existing = await fsp.readlink(symlinkTarget).catch(() => null)
      if (existing !== nodeModulesPath) {
        await fsp.rm(symlinkTarget, { force: true, recursive: true })
        await fsp.symlink(nodeModulesPath, symlinkTarget, 'dir')
      }
    } catch {
      // Symlink creation may fail (permissions) — write NODE_PATH as fallback
      await fsp.writeFile(join(HEADLESS_DIR, 'node_path.txt'), nodeModulesPath, 'utf-8')
    }
  } catch (err) {
    log.error('failed to extract headless script', err)
    return
  }

  // Install if not already installed
  if (!(await platformScheduler.isInstalled())) {
    await platformScheduler.install(nodePath, scriptPath)
    log.info('platform scheduler installed')
  }
}

/** Install or uninstall the platform scheduler based on the setting */
export async function togglePlatformScheduler(db: SqlJsAdapter, enabled: boolean): Promise<void> {
  const platformScheduler = createPlatformScheduler()

  if (enabled) {
    await verifyPlatformScheduler(db)
  } else {
    await platformScheduler.uninstall()
    log.info('platform scheduler uninstalled')
  }
}

/** Expose the SchedulerService instance for use by other main process modules */
export function getSchedulerService(): SchedulerService | null {
  return schedulerService
}

// ─── IPC Handlers ───────────────────────────────────────────

export function registerHandlers(ipcMain: IpcMain, db: SqlJsAdapter): void {
  // Ensure service exists for IPC calls (startScheduler may not have been called yet)
  const svc = () => {
    if (!schedulerService) schedulerService = new SchedulerService(db as any)
    return schedulerService
  }

  ipcMain.handle('scheduler:list', () => svc().list())

  ipcMain.handle('scheduler:get', (_event, id: number) => svc().get(id))

  ipcMain.handle('scheduler:create', (_event, data) => {
    const task = svc().create(data)
    notifyRenderer('conversations:refresh', undefined)
    return task
  })

  ipcMain.handle('scheduler:update', (_event, id: number, data) => {
    svc().update(id, data)
  })

  ipcMain.handle('scheduler:delete', (_event, id: number) => {
    svc().delete(id)
  })

  ipcMain.handle('scheduler:toggle', (_event, id: number, enabled: boolean) => {
    svc().toggle(id, enabled)
  })

  ipcMain.handle('scheduler:runNow', (_event, id: number) => {
    const task = svc().get(id)
    if (!task) throw new Error('Task not found')
    if (task.last_status === 'running') throw new Error('Task is already running')
    executeTask(db, task).catch((err) => {
      log.error('manual run of task failed', err, { taskId: id })
    })
  })

  ipcMain.handle('scheduler:conversationTasks', (_event, conversationId: number) => {
    return svc().conversationTasks(conversationId)
  })

  ipcMain.handle('scheduler:toggleBackground', async (_event, enabled: boolean) => {
    // Save setting
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('scheduler_background_enabled', ?, datetime('now'))")
      .run(enabled ? 'true' : 'false')
    // Install/uninstall platform scheduler
    await togglePlatformScheduler(db, enabled)
    return enabled
  })

  ipcMain.handle('scheduler:backgroundStatus', async () => {
    const enabled = getBackgroundSchedulerEnabled(db)
    const platformScheduler = createPlatformScheduler()
    const installed = await platformScheduler.isInstalled()
    return { enabled, installed }
  })
}
