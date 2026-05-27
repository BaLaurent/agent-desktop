import type Database from 'better-sqlite3'
import { validateString, validatePositiveInt } from '../utils/validate'
import { DEFAULT_MODEL } from '../types/constants'
import type { ScheduledTask, CreateScheduledTask, IntervalUnit, PreRunAction } from '../types'
import { getDefaultFolderId, getDefaultModel, conversationExists } from '../db/queries'
import { getSetting } from '../utils/db'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { validatePreRunAction, validateIntervalUnit, validateScheduleTime } from './scheduler/validation'
import { executeTaskUpdate, executeTaskDelete, executeTaskToggle } from './scheduler/persistence'
import { computeNextRun } from './scheduler/compute'
import { createLogger } from '../utils/logger'

const log = createLogger('scheduler')

// Re-exported for existing callers (tests, main/services/scheduler.ts).
export { computeNextRun }

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

// ─── DB row mapping ────────────────────────────────────────

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
    pre_run_action: (row.pre_run_action as PreRunAction) ?? 'none',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

// ─── SQL queries ───────────────────────────────────────────

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

const DUE_QUERY = `
  SELECT t.*, c.title AS conversation_title
  FROM scheduled_tasks t
  LEFT JOIN conversations c ON c.id = t.conversation_id
  WHERE t.enabled = 1
    AND t.next_run_at <= ?
    AND (t.last_status IS NULL OR t.last_status != 'running')
`

// ─── Update field descriptors ──────────────────────────────
// Each entry maps a CreateScheduledTask key to a (column, transform) pair.
// `transform` validates and converts the input to the SQL bind value.

type FieldDescriptor<K extends keyof CreateScheduledTask> = {
  column: string
  transform: (value: NonNullable<CreateScheduledTask[K]>, db: Database.Database) => unknown
}

const boolToInt = (v: unknown): number => (v ? 1 : 0)

const FIELD_DESCRIPTORS: { [K in keyof CreateScheduledTask]?: FieldDescriptor<K> } = {
  name: { column: 'name', transform: (v) => validateString(v, 'name', 200) },
  prompt: { column: 'prompt', transform: (v) => validateString(v, 'prompt', 10_000_000) },
  conversation_id: {
    column: 'conversation_id',
    transform: (v, db) => {
      validatePositiveInt(v, 'conversation_id')
      if (!conversationExists(db as unknown as SqlJsAdapter, v as number)) throw new Error('Conversation not found')
      return v
    },
  },
  interval_value: { column: 'interval_value', transform: (v) => validatePositiveInt(v, 'interval_value') },
  interval_unit: { column: 'interval_unit', transform: (v) => validateIntervalUnit(v) },
  schedule_time: {
    column: 'schedule_time',
    transform: (v) => {
      validateScheduleTime(v)
      return v || null
    },
  },
  catch_up: { column: 'catch_up', transform: boolToInt },
  max_runs: {
    column: 'max_runs',
    transform: (v) => {
      if (v !== null) validatePositiveInt(v, 'max_runs')
      return v ?? null
    },
  },
  notify_desktop: { column: 'notify_desktop', transform: boolToInt },
  notify_voice: { column: 'notify_voice', transform: boolToInt },
  pre_run_action: { column: 'pre_run_action', transform: (v) => validatePreRunAction(v) },
}

/**
 * Walk the descriptor table once. Each provided (non-undefined) field becomes a
 * `column = ?` clause + bind value. `null` is forwarded for nullable columns
 * (max_runs, schedule_time) — only `undefined` means "skip".
 */
function collectFieldUpdates(
  data: Partial<CreateScheduledTask>,
  db: Database.Database
): { updates: string[]; values: unknown[] } {
  const updates: string[] = []
  const values: unknown[] = []
  for (const key of Object.keys(FIELD_DESCRIPTORS) as (keyof CreateScheduledTask)[]) {
    const value = data[key]
    if (value === undefined) continue
    const descriptor = FIELD_DESCRIPTORS[key] as FieldDescriptor<typeof key> | undefined
    if (!descriptor) continue
    updates.push(`${descriptor.column} = ?`)
    values.push(descriptor.transform(value as never, db))
  }
  return { updates, values }
}

// ─── SchedulerService ──────────────────────────────────────

export class SchedulerService {
  constructor(private db: Database.Database) {}

  list(): ScheduledTask[] {
    return (this.db.prepare(LIST_QUERY).all() as Record<string, unknown>[]).map(rowToTask)
  }

  get(id: number): ScheduledTask | null {
    validatePositiveInt(id, 'id')
    const row = this.db.prepare(GET_QUERY).get(id) as Record<string, unknown> | undefined
    return row ? rowToTask(row) : null
  }

  getDueTasks(now: Date = new Date()): ScheduledTask[] {
    return (this.db.prepare(DUE_QUERY).all(now.toISOString()) as Record<string, unknown>[]).map(rowToTask)
  }

  create(data: CreateScheduledTask): ScheduledTask {
    validateString(data.name, 'name', 200)
    validateString(data.prompt, 'prompt', 10_000_000)
    validatePositiveInt(data.interval_value, 'interval_value')

    validateIntervalUnit(data.interval_unit)
    validateScheduleTime(data.schedule_time)

    // Resolve or create conversation
    let conversationId: number
    if (data.conversation_id) {
      validatePositiveInt(data.conversation_id, 'conversation_id')
      if (!conversationExists(this.db as unknown as SqlJsAdapter, data.conversation_id)) throw new Error('Conversation not found')
      conversationId = data.conversation_id
    } else {
      const model = getDefaultModel(this.db as unknown as SqlJsAdapter) || DEFAULT_MODEL
      const defaultFolderId = getDefaultFolderId(this.db as unknown as SqlJsAdapter)
      const convResult = this.db.prepare(
        "INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))"
      ).run(data.name, defaultFolderId ?? null, model)
      conversationId = convResult.lastInsertRowid as number
    }

    const now = new Date()
    const nextRun = computeNextRun(data.interval_value, data.interval_unit, data.schedule_time || null, now)
    const nowIso = now.toISOString()

    if (data.max_runs !== undefined && data.max_runs !== null) {
      validatePositiveInt(data.max_runs, 'max_runs')
    }

    const preRunAction: PreRunAction = data.pre_run_action !== undefined
      ? validatePreRunAction(data.pre_run_action)
      : 'none'

    const result = this.db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit,
        schedule_time, catch_up, max_runs, notify_desktop, notify_voice, pre_run_action,
        next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      preRunAction,
      nextRun,
      nowIso,
      nowIso,
    )

    return this.get(result.lastInsertRowid as number)!
  }

  // consumed via DispatchRegistry (engine-owned dispatch). (suppressed below)
  // fallow-ignore-next-line unused-class-member
  update(id: number, data: Partial<CreateScheduledTask>): void {
    validatePositiveInt(id, 'id')

    const existing = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!existing) throw new Error('Task not found')

    const { updates, values } = collectFieldUpdates(data, this.db)
    if (updates.length === 0) return

    // Recompute next_run_at with potentially updated schedule
    const iv = (data.interval_value ?? existing.interval_value) as number
    const iu = (data.interval_unit ?? existing.interval_unit) as IntervalUnit
    const st = data.schedule_time !== undefined ? (data.schedule_time || null) : (existing.schedule_time as string | null)
    updates.push('next_run_at = ?')
    values.push(computeNextRun(iv, iu, st))
    updates.push('updated_at = ?')
    values.push(new Date().toISOString())

    executeTaskUpdate(this.db, id, updates, values)
  }

  // consumed via DispatchRegistry (engine-owned dispatch). (suppressed below)
  // fallow-ignore-next-line unused-class-member
  delete(id: number): void {
    validatePositiveInt(id, 'id')
    executeTaskDelete(this.db, id)
  }

  // consumed via DispatchRegistry (engine-owned dispatch). (suppressed below)
  // fallow-ignore-next-line unused-class-member
  toggle(id: number, enabled: boolean): void {
    validatePositiveInt(id, 'id')
    executeTaskToggle(this.db, id, enabled, new Date().toISOString())
  }

  // consumed via DispatchRegistry (engine-owned dispatch). (suppressed below)
  // fallow-ignore-next-line unused-class-member
  conversationTasks(conversationId: number): number[] {
    validatePositiveInt(conversationId, 'conversationId')
    const rows = this.db.prepare('SELECT id FROM scheduled_tasks WHERE conversation_id = ?').all(conversationId) as { id: number }[]
    return rows.map(r => r.id)
  }

  // ─── Status transitions ────────────────────────────────────

  markRunning(id: number): void {
    const now = new Date().toISOString()
    this.db.prepare('UPDATE scheduled_tasks SET last_status = ?, updated_at = ? WHERE id = ?')
      .run('running', now, id)
  }

  markSuccess(id: number, task: ScheduledTask): void {
    const now = new Date().toISOString()
    const reachedLimit = task.max_runs !== null && task.run_count + 1 >= task.max_runs
    if (reachedLimit) {
      this.db.prepare(`
        UPDATE scheduled_tasks
        SET last_run_at = ?, next_run_at = NULL, last_status = 'success', last_error = NULL,
            run_count = run_count + 1, enabled = 0, updated_at = ?
        WHERE id = ?
      `).run(now, now, id)
    } else {
      const nextRun = computeNextRun(task.interval_value, task.interval_unit, task.schedule_time)
      this.db.prepare(`
        UPDATE scheduled_tasks
        SET last_run_at = ?, next_run_at = ?, last_status = 'success', last_error = NULL,
            run_count = run_count + 1, updated_at = ?
        WHERE id = ?
      `).run(now, nextRun, now, id)
    }
  }

  markError(id: number, task: ScheduledTask, error: string): void {
    const now = new Date().toISOString()
    const nextRun = computeNextRun(task.interval_value, task.interval_unit, task.schedule_time)
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET last_run_at = ?, next_run_at = ?, last_status = 'error', last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(now, nextRun, error, now, id)
  }

  // ─── Startup recovery ──────────────────────────────────────

  /** Reset tasks stuck in 'running' state (app crashed mid-execution) */
  recoverStuckTasks(): void {
    const now = new Date().toISOString()
    this.db.prepare(
      "UPDATE scheduled_tasks SET last_status = 'error', last_error = 'App restarted during execution', updated_at = ? WHERE enabled = 1 AND last_status = 'running'"
    ).run(now)
  }

  /** Handle missed runs: catch-up or recompute from now */
  recomputeMissedRuns(): void {
    const tasks = this.db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1').all() as Record<string, unknown>[]
    const now = new Date()
    const nowIso = now.toISOString()

    for (const row of tasks) {
      if (row.next_run_at && new Date(row.next_run_at as string).getTime() < now.getTime()) {
        if (row.catch_up) {
          this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?')
            .run(nowIso, row.id)
        } else {
          const nextRun = computeNextRun(
            row.interval_value as number,
            row.interval_unit as IntervalUnit,
            row.schedule_time as string | null,
            now
          )
          this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?')
            .run(nextRun, row.id)
        }
      }
    }
  }

  /** Reassign scheduled tasks to new conversations before a conversation is deleted */
  reassignOrphanedTasks(conversationId: number): void {
    const tasks = this.db.prepare('SELECT id, name FROM scheduled_tasks WHERE conversation_id = ?')
      .all(conversationId) as { id: number; name: string }[]

    if (tasks.length === 0) return

    const model = getDefaultModel(this.db as unknown as SqlJsAdapter) || DEFAULT_MODEL
    const defaultFolderId = getDefaultFolderId(this.db as unknown as SqlJsAdapter)
    const now = new Date().toISOString()

    for (const task of tasks) {
      const convResult = this.db.prepare(
        "INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))"
      ).run(task.name, defaultFolderId ?? null, model)
      this.db.prepare('UPDATE scheduled_tasks SET conversation_id = ?, updated_at = ? WHERE id = ?')
        .run(convResult.lastInsertRowid as number, now, task.id)
      log.info('Task conversation reassigned', { taskName: task.name, taskId: task.id, oldConvId: conversationId, newConvId: convResult.lastInsertRowid })
    }
  }

  /** Ensure the task's conversation exists. Recreates if deleted. Returns updated task if conversation changed. */
  ensureConversation(task: ScheduledTask): ScheduledTask {
    if (conversationExists(this.db as unknown as SqlJsAdapter, task.conversation_id)) return task

    const model = getDefaultModel(this.db as unknown as SqlJsAdapter) || DEFAULT_MODEL
    const defaultFolderId = getDefaultFolderId(this.db as unknown as SqlJsAdapter)
    const now = new Date().toISOString()

    const convResult = this.db.prepare(
      "INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(task.name, defaultFolderId ?? null, model)
    const newConvId = convResult.lastInsertRowid as number

    this.db.prepare('UPDATE scheduled_tasks SET conversation_id = ?, updated_at = ? WHERE id = ?')
      .run(newConvId, now, task.id)

    log.info('Task conversation recreated', { taskName: task.name, taskId: task.id, oldConvId: task.conversation_id, newConvId })
    return { ...task, conversation_id: newConvId }
  }

  /** Check if conversation still exists (used during streaming to verify it wasn't deleted) */
  conversationExists(conversationId: number): boolean {
    return conversationExists(this.db as unknown as SqlJsAdapter, conversationId)
  }

  /** Check if any enabled tasks exist */
  // consumed via DispatchRegistry (engine-owned dispatch). (suppressed below)
  // fallow-ignore-next-line unused-class-member
  hasEnabledTasks(): boolean {
    const row = this.db.prepare('SELECT 1 FROM scheduled_tasks WHERE enabled = 1 LIMIT 1').get()
    return row !== undefined
  }

  /** Get auto-theme settings and check if switch is needed */
  checkAutoTheme(): string | null {
    const getVal = (key: string): string => getSetting(this.db as any, key)

    if (getVal('autoTheme_enabled') !== 'true') return null

    const dayTheme = getVal('autoTheme_dayTheme')
    const nightTheme = getVal('autoTheme_nightTheme')
    const dayTime = getVal('autoTheme_dayTime') || '07:00'
    const nightTime = getVal('autoTheme_nightTime') || '21:00'

    if (!dayTheme || !nightTheme) return null

    const expected = getExpectedThemeFilename(dayTime, nightTime, dayTheme, nightTheme)
    const current = getVal('activeTheme')

    if (current === expected) return null

    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('activeTheme', ?, datetime('now'))").run(expected)
    return expected
  }
}
