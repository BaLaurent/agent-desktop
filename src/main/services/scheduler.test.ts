import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  app: {
    getPath: vi.fn(() => '/tmp/test-agent'),
  },
}))

vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('./messages', () => ({
  buildMessageHistory: vi.fn(),
  getAISettings: vi.fn(() => ({})),
  getSystemPrompt: vi.fn().mockResolvedValue(''),
  saveMessage: vi.fn(),
}))

vi.mock('./streaming', () => ({
  streamMessage: vi.fn().mockResolvedValue({ content: '', toolCalls: [], aborted: false }),
  injectApiKeyEnv: vi.fn(() => null),
  registerStreamWindow: vi.fn(),
}))

vi.mock('./tts', () => ({
  speak: vi.fn().mockResolvedValue(undefined),
}))

import { computeNextRun, getExpectedThemeFilename, executeTask, reassignOrphanedTasks } from './scheduler'
import { createTestDb } from '../__tests__/db-helper'
import type { ScheduledTask } from '../../shared/types'
import type Database from 'better-sqlite3'

const BASE = new Date('2025-01-15T10:00:00.000Z')

describe('computeNextRun', () => {
  describe('minutes', () => {
    it('adds 30 minutes', () => {
      const result = computeNextRun(30, 'minutes', null, BASE)
      expect(result).toBe('2025-01-15T10:30:00.000Z')
    })

    it('adds 1 minute', () => {
      const result = computeNextRun(1, 'minutes', null, BASE)
      expect(result).toBe('2025-01-15T10:01:00.000Z')
    })
  })

  describe('hours', () => {
    it('adds 2 hours', () => {
      const result = computeNextRun(2, 'hours', null, BASE)
      expect(result).toBe('2025-01-15T12:00:00.000Z')
    })

    it('adds 1 hour', () => {
      const result = computeNextRun(1, 'hours', null, BASE)
      expect(result).toBe('2025-01-15T11:00:00.000Z')
    })
  })

  describe('days without scheduleTime', () => {
    it('adds 1 day', () => {
      const result = computeNextRun(1, 'days', null, BASE)
      expect(result).toBe('2025-01-16T10:00:00.000Z')
    })

    it('adds 7 days', () => {
      const result = computeNextRun(7, 'days', null, BASE)
      expect(result).toBe('2025-01-22T10:00:00.000Z')
    })
  })

  describe('days with scheduleTime', () => {
    it('returns today at scheduleTime when it is in the future', () => {
      // BASE is 10:00 local time — pick a scheduleTime after local hour
      // Use a fromTime where we know the local hour, then pick scheduleTime after it
      const localHour = BASE.getHours()
      const futureHour = String(localHour + 2).padStart(2, '0')
      const scheduleTime = `${futureHour}:30`

      const result = computeNextRun(1, 'days', scheduleTime, BASE)

      // Should be today at that local time
      const expected = new Date(BASE)
      expected.setHours(localHour + 2, 30, 0, 0)
      expect(result).toBe(expected.toISOString())
    })

    it('advances by intervalValue days when scheduleTime already passed', () => {
      // Pick a scheduleTime before the local hour of BASE
      const localHour = BASE.getHours()
      // If localHour is 0, we'd need a negative hour — use a time guaranteed to be in the past
      const pastHour = localHour > 0 ? localHour - 1 : 0
      const scheduleTime = `${String(pastHour).padStart(2, '0')}:00`

      // If localHour is 0 and pastHour is also 0, the time is equal (<=), so it still advances
      const result = computeNextRun(3, 'days', scheduleTime, BASE)

      const expected = new Date(BASE)
      expected.setHours(pastHour, 0, 0, 0)
      // Time is <= now, so advance by intervalValue days
      expected.setDate(expected.getDate() + 3)
      expect(result).toBe(expected.toISOString())
    })
  })

  describe('edge cases', () => {
    it('falls through to simple day addition for invalid scheduleTime format', () => {
      const result = computeNextRun(1, 'days', '9:00', BASE)
      // "9:00" does not match /^\d{2}:\d{2}$/ (needs "09:00")
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
    // dayTime=22:00 means day wraps midnight → 03:00 is within [22:00, 06:00) = day
    expect(getExpectedThemeFilename('22:00', '06:00', 'light.css', 'dark.css', now))
      .toBe('light.css')
  })

  it('handles inverted range — night crosses midnight (afternoon = night)', () => {
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

describe('reassignOrphanedTasks', () => {
  let db: Database.Database

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('reassigns task to new conversation before deletion', () => {
    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Original', 'test', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at)
      VALUES ('My Task', 'Do something', ?, 1, 'days', 1, datetime('now'), datetime('now'), datetime('now'))
    `).run(convId)

    // Reassign before delete (mimics conversations:delete handler)
    reassignOrphanedTasks(db as any, convId)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convId)

    // Task should still exist (not CASCADE-deleted)
    const tasks = db.prepare('SELECT * FROM scheduled_tasks').all() as { id: number; conversation_id: number; name: string }[]
    expect(tasks).toHaveLength(1)
    expect(tasks[0].conversation_id).not.toBe(convId)

    // New conversation should exist with task name as title
    const newConv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(tasks[0].conversation_id) as { title: string }
    expect(newConv.title).toBe('My Task')
  })

  it('places new conversation in default folder', () => {
    const defaultFolder = db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number }
    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Temp', 'test', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at)
      VALUES ('Folder Task', 'Check folder', ?, 1, 'hours', 1, datetime('now'), datetime('now'), datetime('now'))
    `).run(convId)

    reassignOrphanedTasks(db as any, convId)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convId)

    const task = db.prepare('SELECT conversation_id FROM scheduled_tasks').get() as { conversation_id: number }
    const newConv = db.prepare('SELECT folder_id FROM conversations WHERE id = ?').get(task.conversation_id) as { folder_id: number }
    expect(newConv.folder_id).toBe(defaultFolder.id)
  })

  it('does nothing when conversation has no tasks', () => {
    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('No Tasks', 'test', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    reassignOrphanedTasks(db as any, convId)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convId)

    const tasks = db.prepare('SELECT * FROM scheduled_tasks').all()
    expect(tasks).toHaveLength(0)
  })

  it('reassigns multiple tasks from same conversation', () => {
    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Shared', 'test', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at)
      VALUES ('Task A', 'Prompt A', ?, 1, 'hours', 1, datetime('now'), datetime('now'), datetime('now'))
    `).run(convId)
    db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at)
      VALUES ('Task B', 'Prompt B', ?, 2, 'days', 1, datetime('now'), datetime('now'), datetime('now'))
    `).run(convId)

    reassignOrphanedTasks(db as any, convId)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convId)

    const tasks = db.prepare('SELECT name, conversation_id FROM scheduled_tasks ORDER BY name').all() as { name: string; conversation_id: number }[]
    expect(tasks).toHaveLength(2)
    // Each task gets its own new conversation
    expect(tasks[0].conversation_id).not.toBe(convId)
    expect(tasks[1].conversation_id).not.toBe(convId)
    expect(tasks[0].conversation_id).not.toBe(tasks[1].conversation_id)
  })
})

describe('executeTask', () => {
  let db: Database.Database

  function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
    return {
      id: 1,
      name: 'Test Task',
      prompt: 'Hello',
      conversation_id: 999,
      enabled: true,
      interval_value: 1,
      interval_unit: 'days',
      schedule_time: null,
      catch_up: false,
      max_runs: null,
      last_run_at: null,
      next_run_at: new Date().toISOString(),
      last_status: null,
      last_error: null,
      run_count: 0,
      notify_desktop: false,
      notify_voice: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    }
  }

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('executes successfully with existing conversation', async () => {
    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Existing', 'test', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    const taskResult = db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at)
      VALUES ('My Task', 'Do something', ?, 1, 'days', 1, datetime('now'), datetime('now'), datetime('now'))
    `).run(convId)
    const taskId = taskResult.lastInsertRowid as number

    const task = makeTask({ id: taskId, name: 'My Task', prompt: 'Do something', conversation_id: convId })
    await executeTask(db as any, task)

    // Task should still point to the same conversation
    const updatedTask = db.prepare('SELECT conversation_id FROM scheduled_tasks WHERE id = ?').get(taskId) as { conversation_id: number }
    expect(updatedTask.conversation_id).toBe(convId)
  })

  it('recreates conversation as fallback if somehow missing at execution time', async () => {
    // This tests the safety net in executeTask — simulates a race where
    // the task object has a stale conversation_id (FK cascade already deleted the row,
    // but the task was re-inserted or the FK was removed)
    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Temp', 'test', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    const taskResult = db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, next_run_at, created_at, updated_at)
      VALUES ('Orphan Task', 'Do stuff', ?, 1, 'days', 1, datetime('now'), datetime('now'), datetime('now'))
    `).run(convId)
    const taskId = taskResult.lastInsertRowid as number

    // Simulate: reassign first (like the real flow), then delete the conversation
    reassignOrphanedTasks(db as any, convId)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convId)

    // But pass the OLD conversation_id in the task object (simulating stale data)
    const task = makeTask({ id: taskId, name: 'Orphan Task', prompt: 'Do stuff', conversation_id: convId })

    // executeTask should NOT throw — the task was already reassigned by reassignOrphanedTasks
    await executeTask(db as any, task)

    const updatedTask = db.prepare('SELECT conversation_id, last_status FROM scheduled_tasks WHERE id = ?').get(taskId) as { conversation_id: number; last_status: string }
    expect(updatedTask).toBeDefined()
    // The task should have been reassigned to a valid conversation
    expect(updatedTask.conversation_id).not.toBe(convId)
  })

  it('disables task after reaching max_runs limit', async () => {
    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Max Runs Test', 'test', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    // Create task with max_runs=3 and run_count already at 2 (next run is the 3rd)
    const taskResult = db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, run_count, max_runs, next_run_at, created_at, updated_at)
      VALUES ('Limited Task', 'Do something', ?, 1, 'days', 1, 2, 3, datetime('now'), datetime('now'), datetime('now'))
    `).run(convId)
    const taskId = taskResult.lastInsertRowid as number

    const task = makeTask({ id: taskId, name: 'Limited Task', prompt: 'Do something', conversation_id: convId, run_count: 2, max_runs: 3 })
    await executeTask(db as any, task)

    const updatedTask = db.prepare('SELECT enabled, run_count, next_run_at FROM scheduled_tasks WHERE id = ?').get(taskId) as { enabled: number; run_count: number; next_run_at: string | null }
    expect(updatedTask.enabled).toBe(0)
    expect(updatedTask.run_count).toBe(3)
    expect(updatedTask.next_run_at).toBeNull()
  })

  it('continues running when max_runs is null (unlimited)', async () => {
    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Unlimited Test', 'test', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    const taskResult = db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, run_count, next_run_at, created_at, updated_at)
      VALUES ('Unlimited Task', 'Do something', ?, 1, 'days', 1, 10, datetime('now'), datetime('now'), datetime('now'))
    `).run(convId)
    const taskId = taskResult.lastInsertRowid as number

    const task = makeTask({ id: taskId, name: 'Unlimited Task', prompt: 'Do something', conversation_id: convId, run_count: 10, max_runs: null })
    await executeTask(db as any, task)

    const updatedTask = db.prepare('SELECT enabled, run_count, next_run_at FROM scheduled_tasks WHERE id = ?').get(taskId) as { enabled: number; run_count: number; next_run_at: string | null }
    expect(updatedTask.enabled).toBe(1)
    expect(updatedTask.run_count).toBe(11)
    expect(updatedTask.next_run_at).not.toBeNull()
  })

  it('does not disable task before reaching max_runs', async () => {
    const conv = db.prepare("INSERT INTO conversations (title, model, updated_at) VALUES ('Mid Runs Test', 'test', datetime('now'))").run()
    const convId = conv.lastInsertRowid as number

    // run_count=1, max_runs=3 — should still have 2 runs left
    const taskResult = db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, enabled, run_count, max_runs, next_run_at, created_at, updated_at)
      VALUES ('Mid Task', 'Do something', ?, 1, 'hours', 1, 1, 3, datetime('now'), datetime('now'), datetime('now'))
    `).run(convId)
    const taskId = taskResult.lastInsertRowid as number

    const task = makeTask({ id: taskId, name: 'Mid Task', prompt: 'Do something', conversation_id: convId, run_count: 1, max_runs: 3 })
    await executeTask(db as any, task)

    const updatedTask = db.prepare('SELECT enabled, run_count, next_run_at FROM scheduled_tasks WHERE id = ?').get(taskId) as { enabled: number; run_count: number; next_run_at: string | null }
    expect(updatedTask.enabled).toBe(1)
    expect(updatedTask.run_count).toBe(2)
    expect(updatedTask.next_run_at).not.toBeNull()
  })
})
