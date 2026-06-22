/**
 * Headless task runner — executes scheduled tasks without Electron.
 * Invoked by the OS scheduler (cron/launchd/schtasks) via:
 *   node taskRunner.js --tick         # Check + execute all due tasks
 *   node taskRunner.js --run-task 42  # Execute a specific task by ID
 */

import { resolve, join, dirname } from 'path'
import { homedir, hostname } from 'os'
import { mkdirSync, appendFileSync, readlinkSync } from 'fs'
import { spawn } from 'child_process'
import { AgentEngine, noopHookRunner } from '../core'
import type { Broadcaster } from '../core'
import { executeTask } from '../core/services/taskExecutor'
import type { TaskRunContext } from '../core/services/taskExecutor'
import { buildMessageHistory, getAISettings, getSystemPrompt, saveMessage, compactConversation as compactConversationImpl } from '../core/handlers/messages'
import type { MessagesHandlerOptions } from '../core/handlers/messages'
import { streamMessage, setPIBackend } from '../core/services/streaming'
import { streamMessagePI } from '../core/services/streamingPI'
import { enrichHeadlessEnv, getSessionsBase, getKnowledgesDir } from './headlessEnv'
import { loadAndRegisterSDK } from './loadSdk'

const DEFAULT_DB_PATH = join(homedir(), '.config', 'agent-desktop', 'agent.db')
const LOG_PATH = join(homedir(), '.config', 'agent-desktop', 'scheduler-headless.log')
const HEADLESS_DIR = join(homedir(), '.config', 'agent-desktop', 'headless')
const WASM_PATH = join(HEADLESS_DIR, 'sql-wasm.wasm')

/**
 * Detect a live Electron desktop instance via its SingletonLock symlink
 * (target format: `{hostname}-{pid}`).
 *
 * Why this matters: agent.db is sql.js — every process loads the WHOLE file
 * into RAM once and rewrites it wholesale on flush (writeFileSync). Two live
 * writers therefore silently revert each other's changes (last flush wins, no
 * exception, no backup). When the desktop is open it runs its own scheduler
 * tick, so this headless runner must stand down to keep a single writer.
 */
function desktopInstanceAlive(dbPath: string): boolean {
  try {
    const target = readlinkSync(join(dirname(dbPath), 'SingletonLock'))
    const dash = target.lastIndexOf('-')
    if (dash === -1) return false
    if (target.slice(0, dash) !== hostname()) return false
    const pid = parseInt(target.slice(dash + 1), 10)
    if (!Number.isInteger(pid) || pid <= 0) return false
    process.kill(pid, 0) // throws ESRCH if the pid is dead
    return true
  } catch {
    return false
  }
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stderr.write(line)
  try {
    mkdirSync(join(homedir(), '.config', 'agent-desktop'), { recursive: true })
    appendFileSync(LOG_PATH, line)
  } catch { /* ignore */ }
}

const silentBroadcaster: Broadcaster = {
  broadcast(): void { /* no-op in headless runner */ },
}

// ─── Headless notifications ────────────────────────────────

async function headlessNotify(title: string, body: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (process.platform === 'linux') {
      const child = spawn('notify-send', [title, body.slice(0, 200)], { stdio: 'ignore' })
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    } else if (process.platform === 'darwin') {
      const script = `display notification "${body.slice(0, 200).replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`
      const child = spawn('osascript', ['-e', script], { stdio: 'ignore' })
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    } else {
      resolve()
    }
  })
}

// ─── TaskRunContext built from core modules ────────────────

function createCoreContext(db: any): TaskRunContext {
  const sessionsBase = getSessionsBase()
  const knowledgesDir = getKnowledgesDir()
  return {
    db,
    buildHistory(conversationId) {
      return buildMessageHistory(db, conversationId)
    },
    getAISettings(conversationId) {
      return getAISettings(db, conversationId, { sessionsBase, knowledgesDir })
    },
    async getSystemPrompt(conversationId, cwd) {
      return getSystemPrompt(db, conversationId, cwd, { knowledgesDir })
    },
    async streamMessage(history, systemPrompt, aiSettings, conversationId) {
      return streamMessage(history, systemPrompt, aiSettings, conversationId, null, false)
    },
    saveMessage(conversationId, role, content, _attachments, toolCalls) {
      saveMessage(db, conversationId, role as 'user' | 'assistant', content, [], toolCalls)
    },
    async notify(title, body) {
      await headlessNotify(title, body)
    },
    onTaskUpdate(task) {
      log(`[task] ${task.name} (id=${task.id}): ${task.last_status}`)
    },
    onConversationsRefresh() {},
    clearConversation(conversationId: number) {
      // Step back 1ms so the user message saved immediately after passes the strict `created_at > cleared_at` filter
      const clearedAt = new Date(Date.now() - 1).toISOString()
      ;(db as any).prepare(
        'UPDATE conversations SET cleared_at = ?, compact_summary = NULL, sdk_session_id = NULL, pi_session_file = NULL, updated_at = ? WHERE id = ?'
      ).run(clearedAt, clearedAt, conversationId)
      // No invalidateSession call here — headless has no live SDK sessions to tear down.
      // The Electron path (scheduler.ts) calls invalidateSession explicitly to match
      // compactConversation's behaviour; that asymmetry is intentional in headless.
    },
    async compactConversation(conversationId: number) {
      const compactOptions: MessagesHandlerOptions = {
        broadcaster: silentBroadcaster,
        hookRunner: noopHookRunner,
        sessionsBase,
        onSessionInvalidate: () => { /* headless has no live sessions to invalidate */ },
      }
      await compactConversationImpl(db, conversationId, compactOptions)
    },
  }
}

// ─── Tick mode ─────────────────────────────────────────────

async function runTick(): Promise<void> {
  log('[tick] Starting scheduler tick')

  const dbPath = resolve(process.env.AGENT_DB_PATH || DEFAULT_DB_PATH)

  if (desktopInstanceAlive(dbPath)) {
    log('[tick] Desktop instance alive — standing down (it owns the DB and runs its own tick)')
    process.exit(0)
  }

  const engine = new AgentEngine({
    dbPath,
    wasmPath: WASM_PATH,
    themesDir: join(homedir(), '.agent-desktop', 'themes'),
    broadcaster: silentBroadcaster,
  })

  await engine.init()
  log(`[tick] Engine initialized, DB: ${dbPath}`)

  const scheduler = engine.scheduler

  // Reset stuck tasks (safe on every tick)
  scheduler.recoverStuckTasks()

  // Check auto-theme (updates DB if needed)
  scheduler.checkAutoTheme()

  // Get due tasks
  const dueTasks = scheduler.getDueTasks()
  if (dueTasks.length === 0) {
    log('[tick] No due tasks, exiting')
    await engine.shutdown()
    process.exit(0)
  }

  log(`[tick] ${dueTasks.length} due task(s)`)
  const ctx = createCoreContext(engine.db as any)

  // Execute tasks sequentially (sql.js is single-process, no concurrency)
  for (const task of dueTasks) {
    log(`[tick] Executing task "${task.name}" (id=${task.id})`)
    try {
      await executeTask(scheduler, ctx, task)
    } catch (err) {
      log(`[tick] Task ${task.id} error: ${err instanceof Error ? err.message : err}`)
    }
  }

  log('[tick] All tasks processed, shutting down')
  await engine.shutdown()
}

// ─── Run-task mode ─────────────────────────────────────────

async function runTask(taskId: number): Promise<void> {
  log(`[run-task] Running task ${taskId}`)

  const dbPath = resolve(process.env.AGENT_DB_PATH || DEFAULT_DB_PATH)

  if (desktopInstanceAlive(dbPath)) {
    log('[run-task] Desktop instance alive — standing down (it owns the DB and runs its own tick)')
    process.exit(0)
  }

  const engine = new AgentEngine({
    dbPath,
    wasmPath: WASM_PATH,
    themesDir: join(homedir(), '.agent-desktop', 'themes'),
    broadcaster: silentBroadcaster,
  })

  await engine.init()
  const scheduler = engine.scheduler

  const task = scheduler.get(taskId)
  if (!task) {
    log(`[run-task] Task ${taskId} not found`)
    await engine.shutdown()
    process.exit(1)
  }
  if (!task.enabled) {
    log(`[run-task] Task ${taskId} is disabled`)
    await engine.shutdown()
    process.exit(1)
  }

  const ctx = createCoreContext(engine.db as any)
  await executeTask(scheduler, ctx, task)

  log(`[run-task] Task ${taskId} completed`)
  await engine.shutdown()
}

// ─── CLI dispatch ──────────────────────────────────────────

export async function main(args: string[]): Promise<void> {
  enrichHeadlessEnv()

  // Resolve and inject the Claude Agent SDK into Core. Uses node_path.txt
  // for absolute-path resolution when running from outside the project tree
  // (cron invocation of standalone taskRunner.js).
  await loadAndRegisterSDK()
  // Wire PI backend so scheduled tasks running on PI conversations stream
  // through the PI SDK instead of returning "PI backend not configured".
  setPIBackend(streamMessagePI)

  if (args.includes('--tick')) {
    await runTick()
  } else if (args.includes('--run-task')) {
    const idx = args.indexOf('--run-task')
    const taskId = parseInt(args[idx + 1], 10)
    if (isNaN(taskId) || taskId <= 0) {
      console.error('Usage: --run-task <id>')
      process.exit(1)
    }
    await runTask(taskId)
  } else {
    console.error('Usage: node taskRunner.js --tick | --run-task <id>')
    process.exit(1)
  }
}
