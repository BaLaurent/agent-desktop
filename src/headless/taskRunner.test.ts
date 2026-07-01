/**
 * Tests for the headless taskRunner — invoked by cron/launchd to execute
 * scheduled tasks without Electron.
 *
 * What we cover (real behavior, not just imports):
 *   1. CLI dispatch (`main(args)`):
 *        --tick               → runTick path
 *        --run-task <id>      → runTask path with parsed id
 *        bad / missing args   → process.exit(1) with usage message
 *   2. runTick: invokes recoverStuckTasks + checkAutoTheme + iterates dueTasks
 *      and calls executeTask exactly once per task. Empty due-list early-exits.
 *   3. runTask: rejects unknown id (process.exit 1) and disabled task
 *      (process.exit 1); happy path calls executeTask once.
 *   4. SDK is loaded once before any work begins (loadAndRegisterSDK called).
 *
 * What's mocked:
 *   - AgentEngine constructor + scheduler + db: we don't want real sql.js or
 *     real handler wiring in this unit; the bits we care about are the
 *     orchestration glue.
 *   - executeTask: we want to assert it's called with the right args, not
 *     that it actually streams.
 *   - loadAndRegisterSDK / enrichHeadlessEnv: side-effect-y, mocked away.
 *   - core handlers/messages + streaming: pulled in only by createCoreContext;
 *     the context isn't observed in these tests beyond construction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir, hostname } from 'os'
import { join } from 'path'
import { mkdirSync, symlinkSync, rmSync } from 'fs'

// Isolated DB path so desktopInstanceAlive() (reads <dir>/SingletonLock) never
// picks up a real desktop instance on the dev machine during these unit tests.
const ISOLATED_DB_PATH = join(tmpdir(), 'taskrunner-test-isolated', 'agent.db')

// ─── Mocks (must be top-of-file for vi.mock hoisting) ──────────────

const mockEnrichHeadlessEnv = vi.fn()
const mockGetSessionsBase = vi.fn(() => '/tmp/sessions')
const mockGetKnowledgesDir = vi.fn(() => '/tmp/knowledges')
vi.mock('./headlessEnv', () => ({
  enrichHeadlessEnv: () => mockEnrichHeadlessEnv(),
  getSessionsBase: () => mockGetSessionsBase(),
  getKnowledgesDir: () => mockGetKnowledgesDir(),
}))

const mockLoadAndRegisterSDK = vi.fn().mockResolvedValue(undefined)
vi.mock('./loadSdk', () => ({
  loadAndRegisterSDK: () => mockLoadAndRegisterSDK(),
}))

// vi.hoisted: vi.mock factories run before any top-level code; we MUST put
// the captured references inside hoisted() so they exist when the factory
// closure executes.
const hoisted = vi.hoisted(() => {
  const schedulerStub = {
    recoverStuckTasks: vi.fn(),
    checkAutoTheme: vi.fn(),
    getDueTasks: vi.fn<() => unknown[]>(() => []),
    get: vi.fn<(id: number) => unknown | null>(() => null),
  }
  const mockEngineInit = vi.fn().mockResolvedValue(undefined)
  const mockEngineShutdown = vi.fn().mockResolvedValue(undefined)
  class MockAgentEngine {
    scheduler = schedulerStub
    db = {} as unknown
    init = mockEngineInit
    shutdown = mockEngineShutdown
    constructor(_opts: unknown) { /* opts ignored */ }
  }
  return { schedulerStub, mockEngineInit, mockEngineShutdown, MockAgentEngine }
})
const { schedulerStub, mockEngineInit, mockEngineShutdown } = hoisted

vi.mock('../core', () => ({
  AgentEngine: hoisted.MockAgentEngine,
  noopHookRunner: { run: vi.fn() },
}))

const mockExecuteTask = vi.fn().mockResolvedValue(undefined)
vi.mock('../core/services/taskExecutor', () => ({
  executeTask: (...args: unknown[]) => mockExecuteTask(...args),
}))

// These are pulled in by createCoreContext — they're never actually exercised
// in these tests, but the import graph requires them to resolve.
vi.mock('../core/handlers/messages', () => ({
  buildMessageHistory: vi.fn(() => []),
  getAISettings: vi.fn(() => ({})),
  getSystemPrompt: vi.fn(async () => ''),
  saveMessage: vi.fn(),
  compactConversation: vi.fn(async () => {}),
}))

vi.mock('../core/services/streaming', () => ({
  streamMessage: vi.fn(async () => ({ content: '', toolCalls: [], aborted: false, sessionId: null })),
  setPIBackend: vi.fn(),
}))

// taskRunner now wires the omp backend after loading the SDK. Stub the import
// so the test doesn't pull the omp RPC orchestrator into the module graph.
vi.mock('../core/services/streamingOmp', () => ({
  streamMessageOmp: vi.fn(),
}))

// child_process.spawn is used by headlessNotify; stub to avoid touching `notify-send`.
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const handlers: Record<string, () => void> = {}
    return {
      on: (event: string, cb: () => void) => { handlers[event] = cb; if (event === 'close') queueMicrotask(cb) },
    }
  }),
}))

// ─── Subject under test ──────────────────────────────────────────

import { main } from './taskRunner'

// ─── Test helpers ─────────────────────────────────────────────────

function fakeTask(overrides: Partial<{ id: number; name: string; enabled: boolean }> = {}) {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'fake-task',
    enabled: overrides.enabled ?? true,
    prompt: 'do x',
    conversation_id: 1,
    interval_value: 1,
    interval_unit: 'minutes',
    schedule_time: null,
    catch_up: false,
    max_runs: null,
    notify_desktop: true,
    notify_voice: false,
    pre_run_action: 'none',
    next_run_at: new Date().toISOString(),
    last_status: null,
    run_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

/**
 * Trap process.exit so the runner doesn't kill the test process. Throws a
 * marker error containing the exit code; tests can match on it.
 */
class ProcessExit extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

let exitSpy: ReturnType<typeof vi.spyOn>

describe('taskRunner.main', () => {
  beforeEach(() => {
    process.env.AGENT_DB_PATH = ISOLATED_DB_PATH
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExit(code)
    }) as never)
    schedulerStub.recoverStuckTasks.mockClear()
    schedulerStub.checkAutoTheme.mockClear()
    schedulerStub.getDueTasks.mockReset().mockReturnValue([])
    schedulerStub.get.mockReset().mockReturnValue(null)
    mockExecuteTask.mockClear()
    mockEngineInit.mockClear()
    mockEngineShutdown.mockClear()
    mockEnrichHeadlessEnv.mockClear()
    mockLoadAndRegisterSDK.mockClear()
  })

  afterEach(() => {
    delete process.env.AGENT_DB_PATH
    exitSpy.mockRestore()
  })

  describe('argument parsing', () => {
    it('without --tick or --run-task, prints usage and exits 1', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const exitErr = await main([]).catch((e) => e as ProcessExit)
      expect(exitErr).toBeInstanceOf(ProcessExit)
      expect(exitErr.code).toBe(1)
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'))
      errSpy.mockRestore()
    })

    it('--run-task without an id exits 1 with usage', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const err = await main(['--run-task']).catch((e) => e as ProcessExit)
      expect(err).toBeInstanceOf(ProcessExit)
      expect(err.code).toBe(1)
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('--run-task <id>'))
      errSpy.mockRestore()
    })

    it('--run-task with non-numeric id exits 1', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const err = await main(['--run-task', 'notanumber']).catch((e) => e as ProcessExit)
      expect(err).toBeInstanceOf(ProcessExit)
      expect(err.code).toBe(1)
      errSpy.mockRestore()
    })

    it('--run-task with a non-positive id exits 1', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const err = await main(['--run-task', '0']).catch((e) => e as ProcessExit)
      expect(err).toBeInstanceOf(ProcessExit)
      expect(err.code).toBe(1)
      errSpy.mockRestore()
    })

    it('always calls enrichHeadlessEnv() and loadAndRegisterSDK() before dispatch', async () => {
      const err = await main([]).catch((e) => e as ProcessExit)
      expect(err).toBeInstanceOf(ProcessExit) // even on bad args, env must be enriched & SDK loaded
      expect(mockEnrichHeadlessEnv).toHaveBeenCalledTimes(1)
      expect(mockLoadAndRegisterSDK).toHaveBeenCalledTimes(1)
    })
  })

  describe('single-writer gate', () => {
    it('stands down (exit 0, no engine init) when a live desktop holds the SingletonLock', async () => {
      const lockDir = join(tmpdir(), 'taskrunner-test-lockdir')
      mkdirSync(lockDir, { recursive: true })
      const lockPath = join(lockDir, 'SingletonLock')
      rmSync(lockPath, { force: true })
      // Point the lock at THIS process — guaranteed alive during the test.
      symlinkSync(`${hostname()}-${process.pid}`, lockPath)
      process.env.AGENT_DB_PATH = join(lockDir, 'agent.db')

      try {
        const err = await main(['--tick']).catch((e) => e as ProcessExit)
        expect(err).toBeInstanceOf(ProcessExit)
        expect((err as ProcessExit).code).toBe(0)
        expect(mockEngineInit).not.toHaveBeenCalled()
      } finally {
        rmSync(lockDir, { recursive: true, force: true })
      }
    })
  })

  describe('--tick', () => {
    it('runs recoverStuckTasks + checkAutoTheme even when no tasks are due', async () => {
      schedulerStub.getDueTasks.mockReturnValue([])

      const err = await main(['--tick']).catch((e) => e as ProcessExit)
      // No-due-tasks path explicitly calls process.exit(0)
      expect(err).toBeInstanceOf(ProcessExit)
      expect(err.code).toBe(0)

      expect(mockEngineInit).toHaveBeenCalledTimes(1)
      expect(schedulerStub.recoverStuckTasks).toHaveBeenCalledTimes(1)
      expect(schedulerStub.checkAutoTheme).toHaveBeenCalledTimes(1)
      expect(mockExecuteTask).not.toHaveBeenCalled()
      expect(mockEngineShutdown).toHaveBeenCalledTimes(1)
    })

    it('executes each due task and shuts the engine down', async () => {
      const t1 = fakeTask({ id: 1, name: 'a' })
      const t2 = fakeTask({ id: 2, name: 'b' })
      const t3 = fakeTask({ id: 3, name: 'c' })
      schedulerStub.getDueTasks.mockReturnValue([t1, t2, t3])

      await main(['--tick'])

      expect(mockExecuteTask).toHaveBeenCalledTimes(3)
      // Each call: (scheduler, ctx, task). We assert task identity by ref.
      expect(mockExecuteTask.mock.calls[0]?.[2]).toBe(t1)
      expect(mockExecuteTask.mock.calls[1]?.[2]).toBe(t2)
      expect(mockExecuteTask.mock.calls[2]?.[2]).toBe(t3)
      expect(mockEngineShutdown).toHaveBeenCalledTimes(1)
    })

    it('one task throwing does not abort the rest (per-task try/catch)', async () => {
      const t1 = fakeTask({ id: 1, name: 'fails' })
      const t2 = fakeTask({ id: 2, name: 'survives' })
      schedulerStub.getDueTasks.mockReturnValue([t1, t2])
      mockExecuteTask
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined)

      await main(['--tick'])

      expect(mockExecuteTask).toHaveBeenCalledTimes(2)
      expect(mockEngineShutdown).toHaveBeenCalledTimes(1)
    })
  })

  describe('--run-task <id>', () => {
    it('exits 1 if the task does not exist', async () => {
      schedulerStub.get.mockReturnValue(null)

      const err = await main(['--run-task', '42']).catch((e) => e as ProcessExit)
      expect(err).toBeInstanceOf(ProcessExit)
      expect(err.code).toBe(1)
      expect(schedulerStub.get).toHaveBeenCalledWith(42)
      expect(mockExecuteTask).not.toHaveBeenCalled()
      expect(mockEngineShutdown).toHaveBeenCalledTimes(1)
    })

    it('exits 1 if the task exists but is disabled', async () => {
      schedulerStub.get.mockReturnValue(fakeTask({ id: 7, enabled: false }))

      const err = await main(['--run-task', '7']).catch((e) => e as ProcessExit)
      expect(err).toBeInstanceOf(ProcessExit)
      expect(err.code).toBe(1)
      expect(mockExecuteTask).not.toHaveBeenCalled()
      expect(mockEngineShutdown).toHaveBeenCalledTimes(1)
    })

    it('runs an enabled task exactly once', async () => {
      const task = fakeTask({ id: 9, name: 'go', enabled: true })
      schedulerStub.get.mockReturnValue(task)

      await main(['--run-task', '9'])

      expect(schedulerStub.get).toHaveBeenCalledWith(9)
      expect(mockExecuteTask).toHaveBeenCalledTimes(1)
      expect(mockExecuteTask.mock.calls[0]?.[2]).toBe(task)
      expect(mockEngineShutdown).toHaveBeenCalledTimes(1)
    })
  })
})
