import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the structured logger module so tests can spy on log.warn / log.error.
// Hoisted because vi.mock factories are hoisted to top of file.
const mockLog = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
}))
mockLog.child.mockReturnValue(mockLog)
// Keep real pure exports (errToCtx); only createLogger is faked for spying.
vi.mock('../utils/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/logger')>()),
  createLogger: () => mockLog,
}))

import { executeTask, type TaskRunContext, type StreamResult } from './taskExecutor'
import type { SchedulerService } from './scheduler'
import type { ScheduledTask } from '../types'

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 1,
    name: 'Test Task',
    prompt: 'Do something',
    conversation_id: 10,
    enabled: true,
    interval_value: 1,
    interval_unit: 'hours',
    schedule_time: null,
    catch_up: false,
    max_runs: null,
    last_run_at: null,
    next_run_at: null,
    last_status: null,
    last_error: null,
    run_count: 0,
    notify_desktop: false,
    notify_voice: false,
    pre_run_action: 'none',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeStreamResult(overrides: Partial<StreamResult> = {}): StreamResult {
  return {
    content: 'AI response content',
    toolCalls: [],
    aborted: false,
    sessionId: null,
    ...overrides,
  }
}

function createMockScheduler(): {
  [K in keyof Pick<SchedulerService, 'markRunning' | 'markSuccess' | 'markError' | 'get' | 'ensureConversation' | 'conversationExists'>]: ReturnType<typeof vi.fn>
} {
  return {
    markRunning: vi.fn(),
    markSuccess: vi.fn(),
    markError: vi.fn(),
    get: vi.fn(),
    ensureConversation: vi.fn((task: ScheduledTask) => task),
    conversationExists: vi.fn(() => true),
  }
}

function createMockCtx(): {
  buildHistory: ReturnType<typeof vi.fn>
  getAISettings: ReturnType<typeof vi.fn>
  getSystemPrompt: ReturnType<typeof vi.fn>
  streamMessage: ReturnType<typeof vi.fn>
  saveMessage: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  onTaskUpdate: ReturnType<typeof vi.fn>
  onConversationsRefresh: ReturnType<typeof vi.fn>
  clearConversation: ReturnType<typeof vi.fn>
  compactConversation: ReturnType<typeof vi.fn>
  db: any
} {
  return {
    buildHistory: vi.fn(() => []),
    getAISettings: vi.fn(() => ({ cwd: '/tmp', mcpServers: { agent_scheduler: { command: 'node', args: [] } } })),
    getSystemPrompt: vi.fn(async () => 'system prompt'),
    streamMessage: vi.fn(async () => makeStreamResult()),
    saveMessage: vi.fn(),
    notify: vi.fn(async () => {}),
    onTaskUpdate: vi.fn(),
    onConversationsRefresh: vi.fn(),
    clearConversation: vi.fn(),
    compactConversation: vi.fn(async () => {}),
    db: {} as any,
  }
}

describe('executeTask', () => {
  let scheduler: ReturnType<typeof createMockScheduler>
  let ctx: ReturnType<typeof createMockCtx>

  beforeEach(() => {
    scheduler = createMockScheduler()
    ctx = createMockCtx()
  })

  it('success flow: marks running, streams, marks success, notifies', async () => {
    const task = makeTask()
    const updatedTask = { ...task, last_status: 'success' as const }
    scheduler.get.mockReturnValue(updatedTask)

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    expect(scheduler.markRunning).toHaveBeenCalledWith(1)
    expect(ctx.onTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({ last_status: 'running' }))
    expect(ctx.saveMessage).toHaveBeenCalledWith(10, 'user', 'Do something')
    expect(ctx.buildHistory).toHaveBeenCalledWith(10)
    expect(ctx.streamMessage).toHaveBeenCalledOnce()
    expect(ctx.saveMessage).toHaveBeenCalledWith(10, 'assistant', 'AI response content', [], [])
    expect(scheduler.markSuccess).toHaveBeenCalledWith(1, task)
    expect(ctx.onTaskUpdate).toHaveBeenCalledWith(updatedTask)
    expect(ctx.onConversationsRefresh).toHaveBeenCalled()
    expect(scheduler.markError).not.toHaveBeenCalled()
  })

  it('error flow: when streamMessage returns error, marks error', async () => {
    const task = makeTask()
    ctx.streamMessage.mockResolvedValue(makeStreamResult({ error: 'Stream failed' }))
    scheduler.get.mockReturnValue(task)

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    expect(scheduler.markError).toHaveBeenCalledWith(1, task, 'Stream failed')
    expect(scheduler.markSuccess).not.toHaveBeenCalled()
  })

  it('exception flow: when ctx throws, marks error', async () => {
    const task = makeTask()
    ctx.getSystemPrompt.mockRejectedValue(new Error('Prompt generation failed'))
    scheduler.get.mockReturnValue(task)

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    expect(scheduler.markError).toHaveBeenCalledWith(1, task, 'Prompt generation failed')
    expect(scheduler.markSuccess).not.toHaveBeenCalled()
  })

  it('conversation recreation: when ensureConversation returns different task', async () => {
    const task = makeTask()
    const reassigned = { ...task, conversation_id: 99 }
    scheduler.ensureConversation.mockReturnValue(reassigned)
    scheduler.get.mockReturnValue(reassigned)

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    expect(ctx.onConversationsRefresh).toHaveBeenCalled()
    expect(ctx.saveMessage).toHaveBeenCalledWith(99, 'user', 'Do something')
    expect(ctx.buildHistory).toHaveBeenCalledWith(99)
    expect(ctx.getAISettings).toHaveBeenCalledWith(99)
  })

  it('max runs reached: verifies markSuccess is called', async () => {
    const task = makeTask({ max_runs: 3, run_count: 2 })
    scheduler.get.mockReturnValue({ ...task, enabled: false, last_status: 'success' })

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    expect(scheduler.markSuccess).toHaveBeenCalledWith(1, task)
  })

  it('no content and no toolCalls: does not save assistant message', async () => {
    const task = makeTask()
    ctx.streamMessage.mockResolvedValue(makeStreamResult({ content: '', toolCalls: [] }))
    scheduler.get.mockReturnValue(task)

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    // User message saved, but no assistant message
    expect(ctx.saveMessage).toHaveBeenCalledTimes(1)
    expect(ctx.saveMessage).toHaveBeenCalledWith(10, 'user', 'Do something')
    expect(scheduler.markSuccess).toHaveBeenCalled()
  })

  it('no content but toolCalls present: saves assistant message so the trace is preserved (PI tool-only path)', async () => {
    const task = makeTask()
    const toolCalls = [
      { id: 'fc-1', name: 'bash', input: '{"command":"curl ..."}', output: 'HTTP 204', status: 'done' as const },
    ]
    ctx.streamMessage.mockResolvedValue(makeStreamResult({ content: '', toolCalls }))
    scheduler.get.mockReturnValue(task)

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    // Both user and assistant messages saved; assistant has empty content but carries toolCalls
    expect(ctx.saveMessage).toHaveBeenCalledTimes(2)
    expect(ctx.saveMessage).toHaveBeenNthCalledWith(1, 10, 'user', 'Do something')
    expect(ctx.saveMessage).toHaveBeenNthCalledWith(2, 10, 'assistant', '', [], toolCalls)
    expect(scheduler.markSuccess).toHaveBeenCalled()
  })

  it('notification: sends desktop notification when notify_desktop is true', async () => {
    const task = makeTask({ notify_desktop: true })
    scheduler.get.mockReturnValue(task)

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    expect(ctx.notify).toHaveBeenCalledWith('Test Task', 'AI response content')
  })

  it('removes agent_scheduler from mcpServers for unattended execution', async () => {
    const task = makeTask()
    scheduler.get.mockReturnValue(task)

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    const aiSettings = ctx.streamMessage.mock.calls[0][2]
    expect(aiSettings.mcpServers?.['agent_scheduler']).toBeUndefined()
    expect(aiSettings.permissionMode).toBe('bypassPermissions')
  })

  it('resolves variables in task.prompt before saving the user message', async () => {
    const task = makeTask({ name: 'DailyReport', prompt: 'Hello {task_name}!', conversation_id: 1 })

    await executeTask(scheduler as unknown as SchedulerService, ctx, task)

    const calls = (ctx.saveMessage as any).mock.calls
    const userCall = calls.find((c: any) => c[1] === 'user')
    expect(userCall).toBeDefined()
    expect(userCall[2]).toBe('Hello DailyReport!')
  })

  describe('pre_run_action', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it("does NOT call clearConversation or compactConversation when 'none'", async () => {
      scheduler.get.mockReturnValue(makeTask())
      await executeTask(scheduler as any, ctx, makeTask({ pre_run_action: 'none' }))
      expect(ctx.clearConversation).not.toHaveBeenCalled()
      expect(ctx.compactConversation).not.toHaveBeenCalled()
    })

    it("calls clearConversation BEFORE saveMessage('user') when 'clear'", async () => {
      scheduler.get.mockReturnValue(makeTask())
      const callOrder: string[] = []
      ctx.clearConversation.mockImplementation(() => { callOrder.push('clear') })
      ctx.saveMessage.mockImplementation((_id: number, role: string) => {
        if (role === 'user') callOrder.push('saveUser')
      })

      await executeTask(scheduler as any, ctx, makeTask({ pre_run_action: 'clear' }))

      expect(ctx.clearConversation).toHaveBeenCalledWith(10)
      expect(ctx.compactConversation).not.toHaveBeenCalled()
      expect(callOrder.indexOf('clear')).toBeLessThan(callOrder.indexOf('saveUser'))
    })

    it("awaits compactConversation BEFORE saveMessage('user') when 'compact'", async () => {
      scheduler.get.mockReturnValue(makeTask())
      const callOrder: string[] = []
      ctx.compactConversation.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5))
        callOrder.push('compact')
      })
      ctx.saveMessage.mockImplementation((_id: number, role: string) => {
        if (role === 'user') callOrder.push('saveUser')
      })

      await executeTask(scheduler as any, ctx, makeTask({ pre_run_action: 'compact' }))

      expect(ctx.compactConversation).toHaveBeenCalledWith(10)
      expect(ctx.clearConversation).not.toHaveBeenCalled()
      expect(callOrder.indexOf('compact')).toBeLessThan(callOrder.indexOf('saveUser'))
    })

    it("falls back to clearConversation when compactConversation rejects, and still completes the run", async () => {
      scheduler.get.mockReturnValue(makeTask())
      mockLog.warn.mockClear()
      mockLog.error.mockClear()
      ctx.compactConversation.mockRejectedValue(new Error('haiku down'))

      await executeTask(scheduler as any, ctx, makeTask({ pre_run_action: 'compact' }))

      expect(ctx.compactConversation).toHaveBeenCalledOnce()
      expect(ctx.clearConversation).toHaveBeenCalledWith(10)
      expect(ctx.streamMessage).toHaveBeenCalledOnce() // run still executed
      // Migrated to structured logger — capture either warn or error level
      expect(mockLog.warn.mock.calls.length + mockLog.error.mock.calls.length).toBeGreaterThan(0)
    })
  })
})
