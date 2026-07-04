import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { computeNextRun, getExpectedThemeFilename, SchedulerService } from './scheduler'
import { createTestDb } from '../__tests__/db-helper'
import type { ScheduledTask } from '../types'

const BASE = new Date('2025-01-15T10:00:00.000Z')

// ─── Pure functions ───────────────────────────────────────

describe('computeNextRun', () => {
  describe('minutes', () => {
    it('adds 30 minutes', () => {
      expect(computeNextRun(30, 'minutes', null, BASE)).toBe('2025-01-15T10:30:00.000Z')
    })

    it('adds 1 minute', () => {
      expect(computeNextRun(1, 'minutes', null, BASE)).toBe('2025-01-15T10:01:00.000Z')
    })
  })

  describe('hours', () => {
    it('adds 2 hours', () => {
      expect(computeNextRun(2, 'hours', null, BASE)).toBe('2025-01-15T12:00:00.000Z')
    })

    it('adds 1 hour', () => {
      expect(computeNextRun(1, 'hours', null, BASE)).toBe('2025-01-15T11:00:00.000Z')
    })
  })

  describe('days without scheduleTime', () => {
    it('adds 1 day', () => {
      expect(computeNextRun(1, 'days', null, BASE)).toBe('2025-01-16T10:00:00.000Z')
    })

    it('adds 7 days', () => {
      expect(computeNextRun(7, 'days', null, BASE)).toBe('2025-01-22T10:00:00.000Z')
    })
  })

  describe('days with scheduleTime', () => {
    it('returns today at scheduleTime when it is in the future', () => {
      const localHour = BASE.getHours()
      const futureHour = String(localHour + 2).padStart(2, '0')
      const scheduleTime = `${futureHour}:30`

      const result = computeNextRun(1, 'days', scheduleTime, BASE)

      const expected = new Date(BASE)
      expected.setHours(localHour + 2, 30, 0, 0)
      expect(result).toBe(expected.toISOString())
    })

    it('advances by intervalValue days when scheduleTime already passed', () => {
      const localHour = BASE.getHours()
      const pastHour = localHour > 0 ? localHour - 1 : 0
      const scheduleTime = `${String(pastHour).padStart(2, '0')}:00`

      const result = computeNextRun(3, 'days', scheduleTime, BASE)

      const expected = new Date(BASE)
      expected.setHours(pastHour, 0, 0, 0)
      expected.setDate(expected.getDate() + 3)
      expect(result).toBe(expected.toISOString())
    })
  })

  describe('edge cases', () => {
    it('falls through to simple day addition for invalid scheduleTime format', () => {
      const result = computeNextRun(1, 'days', '9:00', BASE)
      expect(result).toBe(new Date(BASE.getTime() + 86_400_000).toISOString())
    })

    it('falls through for completely invalid scheduleTime', () => {
      const result = computeNextRun(2, 'days', 'noon', BASE)
      expect(result).toBe(new Date(BASE.getTime() + 2 * 86_400_000).toISOString())
    })

    it('falls through for empty string scheduleTime', () => {
      const result = computeNextRun(1, 'days', '', BASE)
      expect(result).toBe(new Date(BASE.getTime() + 86_400_000).toISOString())
    })
  })
})

describe('getExpectedThemeFilename', () => {
  it('returns day theme during daytime (normal range)', () => {
    const now = new Date('2025-01-15T12:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })

  it('returns night theme before day starts (normal range)', () => {
    const now = new Date('2025-01-15T05:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('dark.css')
  })

  it('returns night theme after night starts (normal range)', () => {
    const now = new Date('2025-01-15T22:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('dark.css')
  })

  it('returns day theme at exact day start time', () => {
    const now = new Date('2025-01-15T07:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })

  it('returns night theme at exact night start time', () => {
    const now = new Date('2025-01-15T21:00:00')
    expect(getExpectedThemeFilename('07:00', '21:00', 'light.css', 'dark.css', now))
      .toBe('dark.css')
  })

  it('handles inverted range — night crosses midnight (during day)', () => {
    const now = new Date('2025-01-15T23:00:00')
    expect(getExpectedThemeFilename('22:00', '06:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })

  it('handles inverted range — early morning still in day period', () => {
    const now = new Date('2025-01-15T03:00:00')
    expect(getExpectedThemeFilename('22:00', '06:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })

  it('handles inverted range — afternoon = night', () => {
    const now = new Date('2025-01-15T14:00:00')
    expect(getExpectedThemeFilename('22:00', '06:00', 'light.css', 'dark.css', now))
      .toBe('dark.css')
  })

  it('returns day theme when both times are equal', () => {
    const now = new Date('2025-01-15T12:00:00')
    expect(getExpectedThemeFilename('12:00', '12:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })
})

// ─── SchedulerService ─────────────────────────────────────

describe('SchedulerService', () => {
  let db: Database.Database
  let svc: SchedulerService

  function insertConversation(title = 'Test Conv'): number {
    const r = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES (?, 'test-model', datetime('now'))").run(title)
    return r.lastInsertRowid as number
  }

  function insertTask(convId: number, overrides: Record<string, unknown> = {}): number {
    const name = (overrides.name as string) ?? 'Task'
    const prompt = (overrides.prompt as string) ?? 'Do something'
    const iv = (overrides.interval_value as number) ?? 1
    const iu = (overrides.interval_unit as string) ?? 'days'
    const enabled = (overrides.enabled as number) ?? 1
    const catchUp = (overrides.catch_up as number) ?? 1
    const nextRun = (overrides.next_run_at as string) ?? new Date().toISOString()
    const lastStatus = (overrides.last_status as string) ?? null
    const maxRuns = (overrides.max_runs as number) ?? null
    const runCount = (overrides.run_count as number) ?? 0

    const r = db.prepare(`
      INSERT INTO scheduled_tasks
        (name, prompt, conversation_id, interval_value, interval_unit, enabled, catch_up,
         max_runs, run_count, next_run_at, last_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(name, prompt, convId, iv, iu, enabled, catchUp, maxRuns, runCount, nextRun, lastStatus)
    return r.lastInsertRowid as number
  }

  function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
    return {
      id: 1,
      name: 'Task',
      prompt: 'Do something',
      conversation_id: 1,
      enabled: true,
      interval_value: 1,
      interval_unit: 'days',
      schedule_time: null,
      catch_up: false,
      max_runs: null,
      last_run_at: null,
      next_run_at: BASE.toISOString(),
      last_status: null,
      last_error: null,
      run_count: 0,
      notify_desktop: true,
      notify_voice: false,
      created_at: BASE.toISOString(),
      updated_at: BASE.toISOString(),
      ...overrides,
    }
  }

  beforeEach(async () => {
    db = await createTestDb()
    svc = new SchedulerService(db as any)
  })

  // ─── create ───────────────────────────────────────────────

  describe('create', () => {
    it('creates task and auto-creates conversation', () => {
      const task = svc.create({
        name: 'Auto Conv',
        prompt: 'Hello',
        interval_value: 1,
        interval_unit: 'hours',
      })

      expect(task.name).toBe('Auto Conv')
      expect(task.prompt).toBe('Hello')
      expect(task.enabled).toBe(true)
      expect(task.interval_value).toBe(1)
      expect(task.interval_unit).toBe('hours')
      expect(task.next_run_at).toBeTruthy()
      expect(task.conversation_id).toBeGreaterThan(0)

      // Conversation was auto-created
      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(task.conversation_id) as { title: string }
      expect(conv.title).toBe('Auto Conv')
    })

    it('uses existing conversation_id', () => {
      const convId = insertConversation('Existing')

      const task = svc.create({
        name: 'With Conv',
        prompt: 'Test',
        conversation_id: convId,
        interval_value: 30,
        interval_unit: 'minutes',
      })

      expect(task.conversation_id).toBe(convId)
    })

    it('throws if conversation_id does not exist', () => {
      expect(() => svc.create({
        name: 'Bad Conv',
        prompt: 'Test',
        conversation_id: 99999,
        interval_value: 1,
        interval_unit: 'days',
      })).toThrow('Conversation not found')
    })
  })

  // ─── get ──────────────────────────────────────────────────

  describe('get', () => {
    it('returns task by id', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, { name: 'Fetch Me' })

      const task = svc.get(taskId)
      expect(task).not.toBeNull()
      expect(task!.name).toBe('Fetch Me')
      expect(task!.id).toBe(taskId)
    })

    it('returns null for non-existent id', () => {
      expect(svc.get(99999)).toBeNull()
    })
  })

  // ─── list ─────────────────────────────────────────────────

  describe('list', () => {
    it('returns all tasks', () => {
      const convId = insertConversation()
      insertTask(convId, { name: 'A' })
      insertTask(convId, { name: 'B' })

      const tasks = svc.list()
      expect(tasks).toHaveLength(2)
    })

    it('returns empty array when no tasks', () => {
      expect(svc.list()).toHaveLength(0)
    })
  })

  // ─── update ───────────────────────────────────────────────

  describe('update', () => {
    it('partial update fields', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, { name: 'Original' })

      svc.update(taskId, { name: 'Updated', prompt: 'New prompt' })

      const task = svc.get(taskId)!
      expect(task.name).toBe('Updated')
      expect(task.prompt).toBe('New prompt')
    })

    it('throws for non-existent task', () => {
      expect(() => svc.update(99999, { name: 'X' })).toThrow('Task not found')
    })
  })

  // ─── delete ───────────────────────────────────────────────

  describe('delete', () => {
    it('removes task', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId)

      svc.delete(taskId)
      expect(svc.get(taskId)).toBeNull()
    })
  })

  // ─── toggle ───────────────────────────────────────────────

  describe('toggle', () => {
    it('disables a task', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, { enabled: 1 })

      svc.toggle(taskId, false)

      const task = svc.get(taskId)!
      expect(task.enabled).toBe(false)
    })

    it('enables a task and recomputes next_run_at', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, { enabled: 0, next_run_at: '2020-01-01T00:00:00.000Z' })

      svc.toggle(taskId, true)

      const task = svc.get(taskId)!
      expect(task.enabled).toBe(true)
      expect(new Date(task.next_run_at!).getTime()).toBeGreaterThan(Date.now() - 5000)
    })

    it('throws for non-existent task when enabling', () => {
      expect(() => svc.toggle(99999, true)).toThrow('Task not found')
    })
  })

  // ─── getDueTasks ──────────────────────────────────────────

  describe('getDueTasks', () => {
    it('returns enabled tasks with next_run_at <= now and not running', () => {
      const convId = insertConversation()
      const past = '2020-01-01T00:00:00.000Z'
      const future = '2099-01-01T00:00:00.000Z'

      insertTask(convId, { name: 'Due', enabled: 1, next_run_at: past })
      insertTask(convId, { name: 'Future', enabled: 1, next_run_at: future })
      insertTask(convId, { name: 'Disabled', enabled: 0, next_run_at: past })
      insertTask(convId, { name: 'Running', enabled: 1, next_run_at: past, last_status: 'running' })

      const due = svc.getDueTasks(new Date())
      expect(due).toHaveLength(1)
      expect(due[0].name).toBe('Due')
    })
  })

  // ─── markRunning / markSuccess / markError ────────────────

  describe('status transitions', () => {
    it('markRunning sets last_status to running', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId)

      svc.markRunning(taskId)

      const task = svc.get(taskId)!
      expect(task.last_status).toBe('running')
    })

    it('markSuccess increments run_count and sets next_run_at', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, { run_count: 2 })
      const task = makeTask({ id: taskId, conversation_id: convId, run_count: 2 })

      svc.markSuccess(taskId, task)

      const updated = svc.get(taskId)!
      expect(updated.last_status).toBe('success')
      expect(updated.run_count).toBe(3)
      expect(updated.next_run_at).toBeTruthy()
      expect(updated.last_error).toBeNull()
    })

    it('markSuccess with max_runs disables task', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, { run_count: 2, max_runs: 3 })
      const task = makeTask({ id: taskId, conversation_id: convId, run_count: 2, max_runs: 3 })

      svc.markSuccess(taskId, task)

      const updated = svc.get(taskId)!
      expect(updated.enabled).toBe(false)
      expect(updated.run_count).toBe(3)
      expect(updated.next_run_at).toBeNull()
    })

    it('markSuccess does not disable when under max_runs', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, { run_count: 1, max_runs: 5 })
      const task = makeTask({ id: taskId, conversation_id: convId, run_count: 1, max_runs: 5 })

      svc.markSuccess(taskId, task)

      const updated = svc.get(taskId)!
      expect(updated.enabled).toBe(true)
      expect(updated.run_count).toBe(2)
      expect(updated.next_run_at).not.toBeNull()
    })

    it('markError sets error and schedules next run', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId)
      const task = makeTask({ id: taskId, conversation_id: convId })

      svc.markError(taskId, task, 'Something broke')

      const updated = svc.get(taskId)!
      expect(updated.last_status).toBe('error')
      expect(updated.last_error).toBe('Something broke')
      expect(updated.next_run_at).toBeTruthy()
    })
  })

  // ─── recoverStuckTasks ────────────────────────────────────

  describe('recoverStuckTasks', () => {
    it('resets running tasks to error', () => {
      const convId = insertConversation()
      insertTask(convId, { name: 'Stuck', enabled: 1, last_status: 'running' })
      insertTask(convId, { name: 'OK', enabled: 1, last_status: 'success' })

      svc.recoverStuckTasks()

      const stuck = svc.list().find(t => t.name === 'Stuck')!
      const ok = svc.list().find(t => t.name === 'OK')!
      expect(stuck.last_status).toBe('error')
      expect(stuck.last_error).toBe('App restarted during execution')
      expect(ok.last_status).toBe('success')
    })
  })

  // ─── recomputeMissedRuns ──────────────────────────────────

  describe('recomputeMissedRuns', () => {
    it('catch-up: sets next_run_at to now', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, {
        enabled: 1,
        catch_up: 1,
        next_run_at: '2020-01-01T00:00:00.000Z',
        interval_value: 1,
        interval_unit: 'hours',
      })

      const before = Date.now()
      svc.recomputeMissedRuns()
      const after = Date.now()

      const task = svc.get(taskId)!
      const nextMs = new Date(task.next_run_at!).getTime()
      expect(nextMs).toBeGreaterThanOrEqual(before - 1000)
      expect(nextMs).toBeLessThanOrEqual(after + 1000)
    })

    it('skip: recomputes next_run_at from now', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, {
        enabled: 1,
        catch_up: 0,
        next_run_at: '2020-01-01T00:00:00.000Z',
        interval_value: 2,
        interval_unit: 'hours',
      })

      svc.recomputeMissedRuns()

      const task = svc.get(taskId)!
      const nextMs = new Date(task.next_run_at!).getTime()
      // Should be ~2 hours from now, not in the past
      expect(nextMs).toBeGreaterThan(Date.now())
    })

    it('does not touch tasks whose next_run_at is in the future', () => {
      const future = '2099-01-01T00:00:00.000Z'
      const convId = insertConversation()
      const taskId = insertTask(convId, {
        enabled: 1,
        catch_up: 1,
        next_run_at: future,
      })

      svc.recomputeMissedRuns()

      const task = svc.get(taskId)!
      expect(task.next_run_at).toBe(future)
    })
  })

  // ─── reassignOrphanedTasks ────────────────────────────────

  describe('reassignOrphanedTasks', () => {
    it('creates new conversations for tasks on the deleted conversation', () => {
      const convId = insertConversation('Doomed')
      insertTask(convId, { name: 'Orphan A' })
      insertTask(convId, { name: 'Orphan B' })

      svc.reassignOrphanedTasks(convId)
      db.prepare('DELETE FROM conversations WHERE id = ?').run(convId)

      const tasks = svc.list()
      expect(tasks).toHaveLength(2)
      for (const t of tasks) {
        expect(t.conversation_id).not.toBe(convId)
        const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(t.conversation_id) as { title: string }
        expect(conv.title).toBe(t.name)
      }
    })

    it('does nothing when conversation has no tasks', () => {
      const convId = insertConversation('Empty')
      svc.reassignOrphanedTasks(convId)
      // No error, no new conversations created beyond the original
    })
  })

  // ─── ensureConversation ───────────────────────────────────

  describe('ensureConversation', () => {
    it('returns same task if conversation exists', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId)
      const task = svc.get(taskId)!

      const result = svc.ensureConversation(task)
      expect(result.conversation_id).toBe(convId)
    })

    it('creates new conversation if deleted', () => {
      const convId = insertConversation()
      const taskId = insertTask(convId, { name: 'Stale' })
      const task = svc.get(taskId)!

      // Delete the conversation (bypass FK by deleting task's reference)
      svc.reassignOrphanedTasks(convId)
      db.prepare('DELETE FROM conversations WHERE id = ?').run(convId)

      // Now the task was already reassigned by reassignOrphanedTasks,
      // but simulate stale task object pointing to deleted conv
      const staleTask = { ...task, conversation_id: convId }
      const result = svc.ensureConversation(staleTask)
      expect(result.conversation_id).not.toBe(convId)

      const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(result.conversation_id)
      expect(conv).toBeDefined()
    })
  })

  // ─── conversationTasks ────────────────────────────────────

  describe('conversationTasks', () => {
    it('returns task IDs for a conversation', () => {
      const convId = insertConversation()
      const id1 = insertTask(convId, { name: 'A' })
      const id2 = insertTask(convId, { name: 'B' })

      const ids = svc.conversationTasks(convId)
      expect(ids).toContain(id1)
      expect(ids).toContain(id2)
      expect(ids).toHaveLength(2)
    })

    it('returns empty array for conversation with no tasks', () => {
      const convId = insertConversation()
      expect(svc.conversationTasks(convId)).toHaveLength(0)
    })
  })

  // ─── hasEnabledTasks ──────────────────────────────────────

  describe('hasEnabledTasks', () => {
    it('returns true when enabled tasks exist', () => {
      const convId = insertConversation()
      insertTask(convId, { enabled: 1 })

      expect(svc.hasEnabledTasks()).toBe(true)
    })

    it('returns false when no tasks exist', () => {
      expect(svc.hasEnabledTasks()).toBe(false)
    })

    it('returns false when all tasks are disabled', () => {
      const convId = insertConversation()
      insertTask(convId, { enabled: 0 })

      expect(svc.hasEnabledTasks()).toBe(false)
    })
  })

  // ─── checkAutoTheme ───────────────────────────────────────

  describe('checkAutoTheme', () => {
    function setSetting(key: string, value: string) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value)
    }

    it('returns null when auto-theme is disabled', () => {
      expect(svc.checkAutoTheme()).toBeNull()
    })

    it('returns null when day/night themes are not set', () => {
      setSetting('autoTheme_enabled', 'true')
      expect(svc.checkAutoTheme()).toBeNull()
    })

    it('returns null when current theme already matches expected', () => {
      setSetting('autoTheme_enabled', 'true')
      setSetting('autoTheme_dayTheme', 'light.css')
      setSetting('autoTheme_nightTheme', 'dark.css')
      setSetting('autoTheme_dayTime', '00:00')
      setSetting('autoTheme_nightTime', '23:59')
      // With dayTime=00:00 and nightTime=23:59, current time is almost always in day range
      setSetting('activeTheme', 'light.css')

      expect(svc.checkAutoTheme()).toBeNull()
    })

    it('returns new theme and updates setting when switch is needed', () => {
      setSetting('autoTheme_enabled', 'true')
      setSetting('autoTheme_dayTheme', 'light.css')
      setSetting('autoTheme_nightTheme', 'dark.css')
      setSetting('autoTheme_dayTime', '00:00')
      setSetting('autoTheme_nightTime', '23:59')
      // Current time is in day range (00:00 to 23:59), so expected is light.css
      setSetting('activeTheme', 'dark.css')

      const result = svc.checkAutoTheme()
      expect(result).toBe('light.css')

      // Verify setting was updated
      const row = db.prepare("SELECT value FROM settings WHERE key = 'activeTheme'").get() as { value: string }
      expect(row.value).toBe('light.css')
    })
  })
})

describe('SchedulerService — pre_run_action', () => {
  let db: Database.Database
  let service: SchedulerService

  beforeEach(async () => {
    db = await createTestDb()
    service = new SchedulerService(db)
    // Seed a conversation so create() can attach to it
    db.prepare("INSERT INTO conversations (id, title, folder_id, updated_at) VALUES (1, 'Conv', (SELECT id FROM folders WHERE is_default = 1), datetime('now'))").run()
  })

  it("defaults to 'none' when not provided on create", () => {
    const task = service.create({
      name: 'T',
      prompt: 'p',
      conversation_id: 1,
      interval_value: 1,
      interval_unit: 'hours',
    })
    expect(task.pre_run_action).toBe('none')
  })

  it.each(['none', 'clear', 'compact'] as const)("persists '%s' on create", (action) => {
    const task = service.create({
      name: 'T',
      prompt: 'p',
      conversation_id: 1,
      interval_value: 1,
      interval_unit: 'hours',
      pre_run_action: action,
    })
    expect(task.pre_run_action).toBe(action)
  })

  it('throws on invalid value at create time', () => {
    expect(() =>
      service.create({
        name: 'T',
        prompt: 'p',
        conversation_id: 1,
        interval_value: 1,
        interval_unit: 'hours',
        // @ts-expect-error — runtime validation test
        pre_run_action: 'garbage',
      }),
    ).toThrow(/pre_run_action/)
  })

  it('updates pre_run_action and readback reflects it', () => {
    const task = service.create({
      name: 'T',
      prompt: 'p',
      conversation_id: 1,
      interval_value: 1,
      interval_unit: 'hours',
    })
    service.update(task.id, { pre_run_action: 'compact' })
    const reloaded = service.get(task.id)
    expect(reloaded?.pre_run_action).toBe('compact')
  })

  it('throws on invalid value at update time', () => {
    const task = service.create({
      name: 'T',
      prompt: 'p',
      conversation_id: 1,
      interval_value: 1,
      interval_unit: 'hours',
    })
    expect(() =>
      // @ts-expect-error — runtime validation test
      service.update(task.id, { pre_run_action: 'nope' }),
    ).toThrow(/pre_run_action/)
  })
})
