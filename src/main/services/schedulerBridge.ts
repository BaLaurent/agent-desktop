import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import type Database from 'better-sqlite3'
import type { CreateScheduledTask, IntervalUnit } from '../../shared/types'
import { computeNextRun } from './scheduler'
import { validateString, validatePositiveInt } from '../utils/validate'
import { sanitizeError } from '../utils/errors'
import { findBinaryInPath } from '../utils/env'
import { getMainWindow } from '../index'

let server: net.Server | null = null
let socketPath: string | null = null
let authToken: string | null = null
let bridgeDb: Database.Database | null = null

// ─── Socket path ─────────────────────────────────────────────

function getSocketPath(): string {
  const dir = process.env.XDG_RUNTIME_DIR || '/tmp'
  return path.join(dir, `agent-desktop-sched-${process.pid}.sock`)
}

// ─── Bridge request dispatch ─────────────────────────────────

function notifyRenderer(event: string, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(event, data)
  }
}

interface BridgeRequest {
  method: string
  token: string
  params: Record<string, unknown>
}

function dispatch(req: BridgeRequest): unknown {
  if (!bridgeDb) throw new Error('Bridge DB not initialized')
  if (req.token !== authToken) throw new Error('Unauthorized')

  const db = bridgeDb

  switch (req.method) {
    case 'scheduler.create': {
      const p = req.params
      const name = p.name as string
      const prompt = p.prompt as string
      const conversationId = p.conversation_id as number
      const intervalValue = p.interval_value as number
      const intervalUnit = p.interval_unit as IntervalUnit
      const scheduleTime = (p.schedule_time as string) || null
      const oneShot = Boolean(p.one_shot)

      validateString(name, 'name', 200)
      validateString(prompt, 'prompt', 10_000_000)
      validatePositiveInt(conversationId, 'conversation_id')
      validatePositiveInt(intervalValue, 'interval_value')

      const validUnits: IntervalUnit[] = ['minutes', 'hours', 'days']
      if (!validUnits.includes(intervalUnit)) {
        throw new Error('interval_unit must be minutes, hours, or days')
      }
      if (scheduleTime && !/^\d{2}:\d{2}$/.test(scheduleTime)) {
        throw new Error('schedule_time must be HH:MM format')
      }

      // Verify conversation exists
      const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId)
      if (!conv) throw new Error('Conversation not found')

      const now = new Date()
      const nextRun = computeNextRun(intervalValue, intervalUnit, scheduleTime, now)
      const nowIso = now.toISOString()

      const result = db.prepare(`
        INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit,
          schedule_time, catch_up, one_shot, notify_desktop, notify_voice, next_run_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, 0, ?, ?, ?)
      `).run(
        name, prompt, conversationId, intervalValue, intervalUnit,
        scheduleTime, oneShot ? 1 : 0, nextRun, nowIso, nowIso
      )

      const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
        .get(result.lastInsertRowid) as Record<string, unknown>

      notifyRenderer('scheduler:taskUpdate', task)
      return { id: result.lastInsertRowid as number, name, next_run_at: nextRun, one_shot: oneShot }
    }

    case 'scheduler.list': {
      const conversationId = req.params.conversation_id as number
      validatePositiveInt(conversationId, 'conversation_id')

      const rows = db.prepare(
        'SELECT id, name, prompt, enabled, interval_value, interval_unit, one_shot, next_run_at, last_status, run_count FROM scheduled_tasks WHERE conversation_id = ? ORDER BY created_at DESC'
      ).all(conversationId) as Record<string, unknown>[]

      return rows.map(r => ({
        id: r.id,
        name: r.name,
        prompt: (r.prompt as string).slice(0, 200),
        enabled: Boolean(r.enabled),
        interval_value: r.interval_value,
        interval_unit: r.interval_unit,
        one_shot: Boolean(r.one_shot),
        next_run_at: r.next_run_at,
        last_status: r.last_status,
        run_count: r.run_count,
      }))
    }

    case 'scheduler.cancel': {
      const taskId = req.params.task_id as number
      validatePositiveInt(taskId, 'task_id')

      // Only allow cancelling tasks in the caller's conversation
      const conversationId = req.params.conversation_id as number
      if (conversationId) {
        const task = db.prepare('SELECT conversation_id FROM scheduled_tasks WHERE id = ?')
          .get(taskId) as { conversation_id: number } | undefined
        if (!task) throw new Error('Task not found')
        if (task.conversation_id !== conversationId) throw new Error('Task belongs to another conversation')
      }

      db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId)
      notifyRenderer('scheduler:taskUpdate', { id: taskId, deleted: true })
      return { deleted: true }
    }

    default:
      throw new Error(`Unknown method: ${req.method}`)
  }
}

// ─── Socket server ───────────────────────────────────────────

function handleConnection(conn: net.Socket): void {
  let buffer = ''

  conn.on('data', (chunk) => {
    buffer += chunk.toString()
    // Process complete JSON lines
    let newlineIdx: number
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim()
      buffer = buffer.slice(newlineIdx + 1)
      if (!line) continue

      try {
        const req = JSON.parse(line) as BridgeRequest & { id?: string | number }
        const result = dispatch(req)
        conn.write(JSON.stringify({ id: req.id, result }) + '\n')
      } catch (err) {
        const errMsg = sanitizeError(err)
        conn.write(JSON.stringify({ id: null, error: errMsg }) + '\n')
      }
    }
  })

  conn.on('error', (err) => {
    console.error('[schedulerBridge] Connection error:', err.message)
  })
}

// ─── Public API ──────────────────────────────────────────────

export function startBridge(db: Database.Database): void {
  bridgeDb = db
  authToken = randomUUID()
  socketPath = getSocketPath()

  // Clean up stale socket
  try { fs.unlinkSync(socketPath) } catch { /* ok */ }

  server = net.createServer(handleConnection)
  server.listen(socketPath, () => {
    // Set socket permissions to owner-only
    try { fs.chmodSync(socketPath!, 0o600) } catch { /* ok */ }
    console.log('[schedulerBridge] Listening on', socketPath)
  })

  server.on('error', (err) => {
    console.error('[schedulerBridge] Server error:', err)
  })
}

export function stopBridge(): void {
  if (server) {
    server.close()
    server = null
  }
  if (socketPath) {
    try { fs.unlinkSync(socketPath) } catch { /* ok */ }
    socketPath = null
  }
  authToken = null
  bridgeDb = null
  console.log('[schedulerBridge] Stopped')
}

function getServerScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mcp', 'scheduler-server.mjs')
  }
  return path.join(app.getAppPath(), 'resources', 'mcp', 'scheduler-server.mjs')
}

export function getSchedulerMcpConfig(conversationId: number): { command: string; args: string[]; env: Record<string, string> } | null {
  if (!socketPath || !authToken) {
    console.warn('[schedulerBridge] Bridge not started — scheduler MCP unavailable')
    return null
  }

  const nodeBin = findBinaryInPath('node')
  if (!nodeBin) {
    console.warn('[schedulerBridge] Node.js binary not found in PATH — scheduler MCP unavailable')
    return null
  }

  const scriptPath = getServerScriptPath()
  try {
    fs.accessSync(scriptPath, fs.constants.R_OK)
  } catch {
    console.warn('[schedulerBridge] MCP script not found at', scriptPath, '— scheduler MCP unavailable')
    return null
  }

  console.log('[schedulerBridge] MCP config: node=%s script=%s socket=%s conv=%d', nodeBin, scriptPath, socketPath, conversationId)

  return {
    command: nodeBin,
    args: [scriptPath],
    env: {
      SCHEDULER_SOCKET: socketPath,
      SCHEDULER_TOKEN: authToken,
      SCHEDULER_CONVERSATION_ID: String(conversationId),
    },
  }
}
