import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { Notification } from 'electron'
import { getMainWindow } from '../index'
import { buildMessageHistory, getAISettings, getSystemPrompt, saveMessage } from './messages'
import { streamMessage, injectApiKeyEnv, registerStreamWindow } from './streaming'
import { validateString, validatePositiveInt } from '../utils/validate'
import { broadcast } from '../utils/broadcast'
import { sanitizeError } from '../utils/errors'
import { speak as ttsSpeak } from './tts'
import { DEFAULT_MODEL } from '../../shared/constants'
import type { ScheduledTask, CreateScheduledTask, IntervalUnit } from '../../shared/types'

let tickInterval: ReturnType<typeof setInterval> | null = null
let schedulerDb: Database.Database | null = null

// ─── next_run_at computation ────────────────────────────────

export function computeNextRun(
  intervalValue: number,
  intervalUnit: IntervalUnit,
  scheduleTime: string | null,
  fromTime: Date = new Date()
): string {
  const ms = fromTime.getTime()

  if (intervalUnit === 'minutes') {
    return new Date(ms + intervalValue * 60_000).toISOString()
  }

  if (intervalUnit === 'hours') {
    return new Date(ms + intervalValue * 3_600_000).toISOString()
  }

  // days
  if (scheduleTime && /^\d{2}:\d{2}$/.test(scheduleTime)) {
    const [hours, minutes] = scheduleTime.split(':').map(Number)
    const next = new Date(fromTime)
    next.setHours(hours, minutes, 0, 0)
    // If today's time already passed, advance to next interval
    if (next.getTime() <= ms) {
      next.setDate(next.getDate() + intervalValue)
    }
    return next.toISOString()
  }

  return new Date(ms + intervalValue * 86_400_000).toISOString()
}

// ─── Auto day/night theme ───────────────────────────────────

export function getExpectedThemeFilename(
  dayTime: string,
  nightTime: string,
  dayTheme: string,
  nightTheme: string,
  now: Date = new Date()
): string {
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [dayH, dayM] = dayTime.split(':').map(Number)
  const [nightH, nightM] = nightTime.split(':').map(Number)
  const dayMinutes = dayH * 60 + dayM
  const nightMinutes = nightH * 60 + nightM

  if (dayMinutes === nightMinutes) return dayTheme

  if (dayMinutes < nightMinutes) {
    return (currentMinutes >= dayMinutes && currentMinutes < nightMinutes) ? dayTheme : nightTheme
  }
  return (currentMinutes >= dayMinutes || currentMinutes < nightMinutes) ? dayTheme : nightTheme
}

// ─── DB helpers ─────────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: row.id as number,
    name: row.name as string,
    prompt: row.prompt as string,
    conversation_id: row.conversation_id as number,
    conversation_title: (row.conversation_title as string) || undefined,
    enabled: Boolean(row.enabled),
    interval_value: row.interval_value as number,
    interval_unit: row.interval_unit as IntervalUnit,
    schedule_time: (row.schedule_time as string) || null,
    catch_up: Boolean(row.catch_up),
    max_runs: row.max_runs != null ? (row.max_runs as number) : null,
    last_run_at: (row.last_run_at as string) || null,
    next_run_at: (row.next_run_at as string) || null,
    last_status: (row.last_status as ScheduledTask['last_status']) || null,
    last_error: (row.last_error as string) || null,
    run_count: (row.run_count as number) || 0,
    notify_desktop: Boolean(row.notify_desktop ?? 1),
    notify_voice: Boolean(row.notify_voice ?? 0),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

const LIST_QUERY = `
  SELECT t.*, c.title AS conversation_title
  FROM scheduled_tasks t
  LEFT JOIN conversations c ON c.id = t.conversation_id
  ORDER BY t.created_at DESC
`

const GET_QUERY = `
  SELECT t.*, c.title AS conversation_title
  FROM scheduled_tasks t
  LEFT JOIN conversations c ON c.id = t.conversation_id
  WHERE t.id = ?
`

function listTasks(db: Database.Database): ScheduledTask[] {
  return (db.prepare(LIST_QUERY).all() as Record<string, unknown>[]).map(rowToTask)
}

function getTask(db: Database.Database, id: number): ScheduledTask | null {
  const row = db.prepare(GET_QUERY).get(id) as Record<string, unknown> | undefined
  return row ? rowToTask(row) : null
}

// ─── Task execution ─────────────────────────────────────────

function notifyRenderer(event: string, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(event, data)
  }
  broadcast(event, data)
}

/** Reassign scheduled tasks to new conversations before a conversation is deleted (avoids ON DELETE CASCADE). */
export function reassignOrphanedTasks(db: Database.Database, conversationId: number): void {
  const tasks = db.prepare('SELECT id, name FROM scheduled_tasks WHERE conversation_id = ?')
    .all(conversationId) as { id: number; name: string }[]

  if (tasks.length === 0) return

  const modelRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_model'").get() as { value: string } | undefined
  const model = modelRow?.value || DEFAULT_MODEL
  const defaultFolder = db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number } | undefined
  const now = new Date().toISOString()

  for (const task of tasks) {
    const convResult = db.prepare(
      "INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(task.name, defaultFolder?.id ?? null, model)
    db.prepare('UPDATE scheduled_tasks SET conversation_id = ?, updated_at = ? WHERE id = ?')
      .run(convResult.lastInsertRowid as number, now, task.id)
    console.log(`[scheduler] Task "${task.name}" (id=${task.id}): conversation ${conversationId} deleted, reassigned to new conversation ${convResult.lastInsertRowid}`)
  }
}

export async function executeTask(db: Database.Database, task: ScheduledTask): Promise<void> {
  const now = new Date().toISOString()

  // Mark as running
  db.prepare('UPDATE scheduled_tasks SET last_status = ?, updated_at = ? WHERE id = ?')
    .run('running', now, task.id)
  notifyRenderer('scheduler:taskUpdate', { ...task, last_status: 'running' })

  try {
    // Verify conversation still exists — recreate if deleted
    const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(task.conversation_id) as { id: number } | undefined
    if (!conv) {
      const modelRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_model'").get() as { value: string } | undefined
      const model = modelRow?.value || DEFAULT_MODEL
      const defaultFolder = db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number } | undefined
      const convResult = db.prepare(
        "INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))"
      ).run(task.name, defaultFolder?.id ?? null, model)
      const newConvId = convResult.lastInsertRowid as number

      db.prepare('UPDATE scheduled_tasks SET conversation_id = ?, updated_at = ? WHERE id = ?')
        .run(newConvId, now, task.id)
      task = { ...task, conversation_id: newConvId }

      console.log(`[scheduler] Task "${task.name}" (id=${task.id}): conversation was deleted, created new conversation ${newConvId}`)
      notifyRenderer('conversations:refresh', undefined)
    }

    // Save user message (the scheduled prompt)
    saveMessage(db, task.conversation_id, 'user', task.prompt)

    // Build context — same flow as messages:send
    const history = buildMessageHistory(db, task.conversation_id)
    const aiSettings = getAISettings(db, task.conversation_id)

    // Force bypass for unattended execution
    aiSettings.permissionMode = 'bypassPermissions'

    // Prevent recursive task creation: remove scheduler MCP from unattended execution
    delete aiSettings.mcpServers?.['agent_scheduler']

    const systemPrompt = await getSystemPrompt(db, task.conversation_id, aiSettings.cwd!)

    // Inject API key env if configured
    const restoreEnv = injectApiKeyEnv(aiSettings.apiKey, aiSettings.baseUrl)

    // Ensure main window is registered for streaming (task may run before user opens conversation)
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      registerStreamWindow(win)
    }

    try {
      const { content, toolCalls, error } = await streamMessage(
        history, systemPrompt, aiSettings, task.conversation_id
      )

      if (error) throw new Error(error)

      if (content) {
        // Check conversation still exists (may have been deleted during streaming)
        const stillExists = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(task.conversation_id)
        if (stillExists) {
          saveMessage(db, task.conversation_id, 'assistant', content, [], toolCalls)
        }
      }

      // Update task: success
      const reachedLimit = task.max_runs !== null && task.run_count + 1 >= task.max_runs
      if (reachedLimit) {
        // Reached max_runs limit: disable and clear next_run_at
        db.prepare(`
          UPDATE scheduled_tasks
          SET last_run_at = ?, next_run_at = NULL, last_status = 'success', last_error = NULL,
              run_count = run_count + 1, enabled = 0, updated_at = ?
          WHERE id = ?
        `).run(now, now, task.id)
      } else {
        const nextRun = computeNextRun(task.interval_value, task.interval_unit, task.schedule_time)
        db.prepare(`
          UPDATE scheduled_tasks
          SET last_run_at = ?, next_run_at = ?, last_status = 'success', last_error = NULL,
              run_count = run_count + 1, updated_at = ?
          WHERE id = ?
        `).run(now, nextRun, now, task.id)
      }

      const updated = getTask(db, task.id)
      if (updated) notifyRenderer('scheduler:taskUpdate', updated)

      // Desktop notification
      if (task.notify_desktop) {
        try {
          new Notification({
            title: task.name,
            body: (content || 'Task completed').slice(0, 200),
          }).show()
        } catch { /* notification may fail in some environments */ }
      }

      // Voice notification (TTS)
      if (task.notify_voice) {
        ttsSpeak((content || 'Task completed').slice(0, 500), db)
          .catch(err => console.error('[scheduler] Voice notification error:', err))
      }

      // Refresh conversation list in renderer
      notifyRenderer('conversations:refresh', undefined)
    } finally {
      restoreEnv?.()
    }
  } catch (err) {
    const errorMsg = sanitizeError(err)
    const nextRun = computeNextRun(task.interval_value, task.interval_unit, task.schedule_time)
    db.prepare(`
      UPDATE scheduled_tasks
      SET last_run_at = ?, next_run_at = ?, last_status = 'error', last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(now, nextRun, errorMsg, now, task.id)

    const updated = getTask(db, task.id)
    if (updated) notifyRenderer('scheduler:taskUpdate', updated)

    console.error(`[scheduler] Task "${task.name}" (id=${task.id}) failed:`, errorMsg)
  }
}

// ─── Auto day/night theme check ─────────────────────────────

function checkAutoTheme(db: Database.Database): void {
  const getVal = (key: string): string | null => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  if (getVal('autoTheme_enabled') !== 'true') return

  const dayTheme = getVal('autoTheme_dayTheme')
  const nightTheme = getVal('autoTheme_nightTheme')
  const dayTime = getVal('autoTheme_dayTime') || '07:00'
  const nightTime = getVal('autoTheme_nightTime') || '21:00'

  if (!dayTheme || !nightTheme) return

  const expected = getExpectedThemeFilename(dayTime, nightTime, dayTheme, nightTheme)
  const current = getVal('activeTheme')

  if (current === expected) return

  db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('activeTheme', ?, datetime('now'))").run(expected)
  notifyRenderer('theme:autoSwitch', expected)
}

// ─── Scheduler engine ───────────────────────────────────────

function tick(): void {
  if (!schedulerDb) return
  checkAutoTheme(schedulerDb)

  const now = new Date().toISOString()
  const dueTasks = schedulerDb.prepare(`
    SELECT t.*, c.title AS conversation_title
    FROM scheduled_tasks t
    LEFT JOIN conversations c ON c.id = t.conversation_id
    WHERE t.enabled = 1
      AND t.next_run_at <= ?
      AND (t.last_status IS NULL OR t.last_status != 'running')
  `).all(now) as Record<string, unknown>[]

  for (const row of dueTasks) {
    const task = rowToTask(row)
    // Fire-and-forget: each task runs concurrently
    executeTask(schedulerDb, task).catch((err) => {
      console.error(`[scheduler] Unexpected error in task ${task.id}:`, err)
    })
  }
}

export function startScheduler(db: Database.Database): void {
  schedulerDb = db

  // Startup recovery
  const tasks = db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1').all() as Record<string, unknown>[]
  const now = new Date()
  const nowIso = now.toISOString()

  for (const row of tasks) {
    // Reset stuck 'running' tasks (app crashed mid-execution)
    if (row.last_status === 'running') {
      db.prepare("UPDATE scheduled_tasks SET last_status = 'error', last_error = 'App restarted during execution', updated_at = ? WHERE id = ?")
        .run(nowIso, row.id)
    }

    // Handle missed runs
    if (row.next_run_at && new Date(row.next_run_at as string).getTime() < now.getTime()) {
      if (row.catch_up) {
        // Catch-up: run immediately on next tick
        db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?')
          .run(nowIso, row.id)
      } else {
        // Skip missed: recompute from now
        const nextRun = computeNextRun(
          row.interval_value as number,
          row.interval_unit as IntervalUnit,
          row.schedule_time as string | null,
          now
        )
        db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?')
          .run(nextRun, row.id)
      }
    }
  }

  // Auto-theme: check on startup
  checkAutoTheme(db)

  // 1-minute tick resolution
  tickInterval = setInterval(tick, 60_000)
  console.log('[scheduler] Started with', tasks.length, 'enabled tasks')
}

export function stopScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
  schedulerDb = null
  console.log('[scheduler] Stopped')
}

// ─── IPC Handlers ───────────────────────────────────────────

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('scheduler:list', () => {
    return listTasks(db)
  })

  ipcMain.handle('scheduler:get', (_event, id: number) => {
    validatePositiveInt(id, 'id')
    return getTask(db, id)
  })

  ipcMain.handle('scheduler:create', (_event, data: CreateScheduledTask) => {
    validateString(data.name, 'name', 200)
    validateString(data.prompt, 'prompt', 10_000_000)
    validatePositiveInt(data.interval_value, 'interval_value')

    const validUnits: IntervalUnit[] = ['minutes', 'hours', 'days']
    if (!validUnits.includes(data.interval_unit)) {
      throw new Error('interval_unit must be minutes, hours, or days')
    }

    // Validate schedule_time format if provided
    if (data.schedule_time && !/^\d{2}:\d{2}$/.test(data.schedule_time)) {
      throw new Error('schedule_time must be HH:MM format')
    }

    // Resolve or create conversation
    let conversationId: number
    if (data.conversation_id) {
      validatePositiveInt(data.conversation_id, 'conversation_id')
      const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(data.conversation_id)
      if (!conv) throw new Error('Conversation not found')
      conversationId = data.conversation_id
    } else {
      // Auto-create a conversation named after the task
      const modelRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_model'").get() as { value: string } | undefined
      const model = modelRow?.value || DEFAULT_MODEL
      const convResult = db.prepare(
        "INSERT INTO conversations (title, model, updated_at) VALUES (?, ?, datetime('now'))"
      ).run(data.name, model)
      conversationId = convResult.lastInsertRowid as number

      // Notify renderer so sidebar refreshes
      notifyRenderer('conversations:refresh', undefined)
    }

    const now = new Date()
    const nextRun = computeNextRun(data.interval_value, data.interval_unit, data.schedule_time || null, now)
    const nowIso = now.toISOString()

    // Validate max_runs: must be null or positive integer
    if (data.max_runs !== undefined && data.max_runs !== null) {
      validatePositiveInt(data.max_runs, 'max_runs')
    }

    const result = db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit,
        schedule_time, catch_up, max_runs, notify_desktop, notify_voice, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name,
      data.prompt,
      conversationId,
      data.interval_value,
      data.interval_unit,
      data.schedule_time || null,
      data.catch_up !== false ? 1 : 0,
      data.max_runs ?? null,
      data.notify_desktop !== false ? 1 : 0,
      data.notify_voice ? 1 : 0,
      nextRun,
      nowIso,
      nowIso,
    )

    return getTask(db, result.lastInsertRowid as number)
  })

  ipcMain.handle('scheduler:update', (_event, id: number, data: Partial<CreateScheduledTask>) => {
    validatePositiveInt(id, 'id')

    const existing = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!existing) throw new Error('Task not found')

    const updates: string[] = []
    const values: unknown[] = []

    if (data.name !== undefined) {
      validateString(data.name, 'name', 200)
      updates.push('name = ?')
      values.push(data.name)
    }
    if (data.prompt !== undefined) {
      validateString(data.prompt, 'prompt', 10_000_000)
      updates.push('prompt = ?')
      values.push(data.prompt)
    }
    if (data.conversation_id !== undefined) {
      validatePositiveInt(data.conversation_id, 'conversation_id')
      const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(data.conversation_id)
      if (!conv) throw new Error('Conversation not found')
      updates.push('conversation_id = ?')
      values.push(data.conversation_id)
    }
    if (data.interval_value !== undefined) {
      validatePositiveInt(data.interval_value, 'interval_value')
      updates.push('interval_value = ?')
      values.push(data.interval_value)
    }
    if (data.interval_unit !== undefined) {
      const validUnits: IntervalUnit[] = ['minutes', 'hours', 'days']
      if (!validUnits.includes(data.interval_unit)) throw new Error('Invalid interval_unit')
      updates.push('interval_unit = ?')
      values.push(data.interval_unit)
    }
    if (data.schedule_time !== undefined) {
      if (data.schedule_time && !/^\d{2}:\d{2}$/.test(data.schedule_time)) {
        throw new Error('schedule_time must be HH:MM format')
      }
      updates.push('schedule_time = ?')
      values.push(data.schedule_time || null)
    }
    if (data.catch_up !== undefined) {
      updates.push('catch_up = ?')
      values.push(data.catch_up ? 1 : 0)
    }
    if (data.max_runs !== undefined) {
      if (data.max_runs !== null) validatePositiveInt(data.max_runs, 'max_runs')
      updates.push('max_runs = ?')
      values.push(data.max_runs ?? null)
    }
    if (data.notify_desktop !== undefined) {
      updates.push('notify_desktop = ?')
      values.push(data.notify_desktop ? 1 : 0)
    }
    if (data.notify_voice !== undefined) {
      updates.push('notify_voice = ?')
      values.push(data.notify_voice ? 1 : 0)
    }

    if (updates.length === 0) return

    // Recompute next_run_at with potentially updated schedule
    const iv = (data.interval_value ?? existing.interval_value) as number
    const iu = (data.interval_unit ?? existing.interval_unit) as IntervalUnit
    const st = data.schedule_time !== undefined ? (data.schedule_time || null) : (existing.schedule_time as string | null)
    const nextRun = computeNextRun(iv, iu, st)
    updates.push('next_run_at = ?')
    values.push(nextRun)

    const now = new Date().toISOString()
    updates.push('updated_at = ?')
    values.push(now)

    values.push(id)
    db.prepare(`UPDATE scheduled_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  })

  ipcMain.handle('scheduler:delete', (_event, id: number) => {
    validatePositiveInt(id, 'id')
    db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
  })

  ipcMain.handle('scheduler:toggle', (_event, id: number, enabled: boolean) => {
    validatePositiveInt(id, 'id')
    const now = new Date().toISOString()

    if (enabled) {
      // Recompute next_run_at when re-enabling
      const row = db.prepare('SELECT interval_value, interval_unit, schedule_time FROM scheduled_tasks WHERE id = ?')
        .get(id) as { interval_value: number; interval_unit: IntervalUnit; schedule_time: string | null } | undefined
      if (!row) throw new Error('Task not found')
      const nextRun = computeNextRun(row.interval_value, row.interval_unit, row.schedule_time)
      db.prepare('UPDATE scheduled_tasks SET enabled = 1, next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(nextRun, now, id)
    } else {
      db.prepare('UPDATE scheduled_tasks SET enabled = 0, updated_at = ? WHERE id = ?')
        .run(now, id)
    }
  })

  ipcMain.handle('scheduler:runNow', (_event, id: number) => {
    validatePositiveInt(id, 'id')
    const task = getTask(db, id)
    if (!task) throw new Error('Task not found')
    if (task.last_status === 'running') throw new Error('Task is already running')

    // Fire-and-forget
    executeTask(db, task).catch((err) => {
      console.error(`[scheduler] Manual run of task ${id} failed:`, err)
    })
  })

  ipcMain.handle('scheduler:conversationTasks', (_event, conversationId: number) => {
    validatePositiveInt(conversationId, 'conversationId')
    const rows = db.prepare('SELECT id FROM scheduled_tasks WHERE conversation_id = ?').all(conversationId) as { id: number }[]
    return rows.map(r => r.id)
  })
}
