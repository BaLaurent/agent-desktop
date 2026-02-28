import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PromptController } from './sessionManager'

// ─── PromptController tests ──────────────────────────────────

describe('PromptController', () => {
  it('yields pushed messages in order', async () => {
    const ctrl = new PromptController()
    const msg1 = { type: 'user' as const, message: { role: 'user' as const, content: 'hello' }, parent_tool_use_id: null, session_id: '' }
    const msg2 = { type: 'user' as const, message: { role: 'user' as const, content: 'world' }, parent_tool_use_id: null, session_id: '' }

    ctrl.push(msg1)
    ctrl.push(msg2)
    ctrl.close()

    const results: typeof msg1[] = []
    for await (const m of ctrl) {
      results.push(m)
    }

    expect(results).toHaveLength(2)
    expect(results[0].message.content).toBe('hello')
    expect(results[1].message.content).toBe('world')
  })

  it('waits for messages when queue is empty', async () => {
    const ctrl = new PromptController()
    const msg = { type: 'user' as const, message: { role: 'user' as const, content: 'delayed' }, parent_tool_use_id: null, session_id: '' }

    const results: typeof msg[] = []
    const consumer = (async () => {
      for await (const m of ctrl) {
        results.push(m)
      }
    })()

    // Push after a small delay — consumer should be waiting
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(results).toHaveLength(0)

    ctrl.push(msg)
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(results).toHaveLength(1)
    expect(results[0].message.content).toBe('delayed')

    ctrl.close()
    await consumer
  })

  it('stops iteration when closed with empty queue', async () => {
    const ctrl = new PromptController()

    const consumer = (async () => {
      const results: unknown[] = []
      for await (const m of ctrl) {
        results.push(m)
      }
      return results
    })()

    ctrl.close()
    const results = await consumer
    expect(results).toHaveLength(0)
  })

  it('drains remaining messages before stopping on close', async () => {
    const ctrl = new PromptController()
    const msg = { type: 'user' as const, message: { role: 'user' as const, content: 'last' }, parent_tool_use_id: null, session_id: '' }

    ctrl.push(msg)
    ctrl.close()

    const results: typeof msg[] = []
    for await (const m of ctrl) {
      results.push(m)
    }

    expect(results).toHaveLength(1)
    expect(results[0].message.content).toBe('last')
  })

  it('ignores push after close', async () => {
    const ctrl = new PromptController()
    ctrl.close()

    const msg = { type: 'user' as const, message: { role: 'user' as const, content: 'ignored' }, parent_tool_use_id: null, session_id: '' }
    ctrl.push(msg) // should be silently ignored

    const results: unknown[] = []
    for await (const m of ctrl) {
      results.push(m)
    }
    expect(results).toHaveLength(0)
  })

  it('isClosed reflects state', () => {
    const ctrl = new PromptController()
    expect(ctrl.isClosed).toBe(false)
    ctrl.close()
    expect(ctrl.isClosed).toBe(true)
  })

  it('can iterate with multiple sequential pushes and waits', async () => {
    const ctrl = new PromptController()
    const mkMsg = (content: string) => ({
      type: 'user' as const,
      message: { role: 'user' as const, content },
      parent_tool_use_id: null,
      session_id: '',
    })

    const results: string[] = []
    const consumer = (async () => {
      for await (const m of ctrl) {
        results.push(m.message.content)
      }
    })()

    // Simulate multiple turns with delays between them
    ctrl.push(mkMsg('turn1'))
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(results).toEqual(['turn1'])

    ctrl.push(mkMsg('turn2'))
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(results).toEqual(['turn1', 'turn2'])

    ctrl.push(mkMsg('turn3'))
    ctrl.close()
    await consumer
    expect(results).toEqual(['turn1', 'turn2', 'turn3'])
  })
})

// ─── Module-level function tests ─────────────────────────────
// These test the exported API (invalidateSession, shutdownAllSessions, etc.)
// by mocking the SDK and observing side effects.

// We need to mock the dependencies before importing the functions
vi.mock('./anthropic', () => ({
  loadAgentSDK: vi.fn(),
}))

vi.mock('./streaming', () => ({
  sendChunk: vi.fn(),
  abortControllers: new Map(),
  respondToApproval: vi.fn(),
  buildPromptWithHistory: vi.fn((msgs: Array<{ content: string }>) => msgs.map((m) => m.content).join('\n')),
  injectApiKeyEnv: vi.fn(() => null),
}))

vi.mock('./cwdHooks', () => ({
  buildCwdRestrictionHooks: vi.fn(() => ({})),
}))

vi.mock('../utils/env', () => ({
  findBinaryInPath: vi.fn(() => '/usr/bin/node'),
  ensureFreshMacOSToken: vi.fn(async () => {}),
}))

describe('SessionManager API', () => {
  let sessionManager: typeof import('./sessionManager')
  let mockSdk: { query: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.resetModules()
    // Fresh import to reset module-level state (sessions Map)
    sessionManager = await import('./sessionManager')
    const anthropic = await import('./anthropic')

    mockSdk = {
      query: vi.fn(),
    }
    vi.mocked(anthropic.loadAgentSDK).mockResolvedValue(mockSdk as any)
  })

  afterEach(() => {
    // Clean up any sessions
    sessionManager.shutdownAllSessions()
  })

  it('hasActiveSession returns false for unknown conversation', () => {
    expect(sessionManager.hasActiveSession(999)).toBe(false)
  })

  it('getSession returns null for unknown conversation', () => {
    expect(sessionManager.getSession(999)).toBeNull()
  })

  it('invalidateSession is a no-op for unknown conversation', () => {
    // Should not throw
    sessionManager.invalidateSession(999)
  })

  it('shutdownAllSessions is a no-op with no sessions', () => {
    // Should not throw
    sessionManager.shutdownAllSessions()
  })

  it('respondToSessionApproval returns false when no sessions exist', () => {
    expect(sessionManager.respondToSessionApproval('req-1', { behavior: 'allow' } as any)).toBe(false)
  })

  it('sendTurn creates a session and resolves when result arrives', async () => {
    // Create a mock query that yields messages and a result
    const messages: Array<Record<string, unknown>> = [
      { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sess-1' },
      {
        type: 'stream_event',
        session_id: 'sess-1',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello!' },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        stop_reason: 'end_turn',
        session_id: 'sess-1',
        result: 'Hello!',
        duration_ms: 100,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0.01,
        usage: {},
      },
    ]

    let iterIndex = 0
    const mockQuery = {
      [Symbol.asyncIterator]: () => ({
        async next() {
          if (iterIndex < messages.length) {
            return { value: messages[iterIndex++], done: false }
          }
          // After result, wait forever (session stays alive)
          return new Promise<{ value: undefined; done: true }>(() => {})
        },
      }),
      close: vi.fn(),
    }

    mockSdk.query.mockReturnValue(mockQuery)

    const aiSettings = {
      model: 'claude-sonnet-4-20250514',
      cwd: '/tmp/test',
      permissionMode: 'bypassPermissions',
    }

    const result = await sessionManager.sendTurn(
      1,
      [{ role: 'user', content: 'Hello' }],
      'You are helpful',
      aiSettings as any,
      null
    )

    expect(result.content).toBe('Hello!')
    expect(result.aborted).toBe(false)
    expect(result.sessionId).toBe('sess-1')
    expect(sessionManager.hasActiveSession(1)).toBe(true)

    // Cleanup
    sessionManager.invalidateSession(1)
    expect(sessionManager.hasActiveSession(1)).toBe(false)
  })

  it('invalidateSession closes the session and rejects pending turn', async () => {
    // Create a mock query that never yields a result
    let resolveIter: (() => void) | null = null
    const mockQuery = {
      [Symbol.asyncIterator]: () => ({
        async next() {
          // Block forever
          return new Promise<{ value: undefined; done: true }>((resolve) => {
            resolveIter = () => resolve({ value: undefined, done: true })
          })
        },
      }),
      close: vi.fn(() => {
        // When close is called, unblock the iterator
        if (resolveIter) resolveIter()
      }),
    }

    mockSdk.query.mockReturnValue(mockQuery)

    const aiSettings = {
      model: 'claude-sonnet-4-20250514',
      cwd: '/tmp/test',
      permissionMode: 'bypassPermissions',
    }

    // Start a turn (it will block waiting for result)
    const turnPromise = sessionManager.sendTurn(
      2,
      [{ role: 'user', content: 'Hello' }],
      'You are helpful',
      aiSettings as any,
      null
    )

    // Give the async iterator time to start
    await new Promise<void>((r) => setTimeout(r, 50))

    // Invalidate the session
    sessionManager.invalidateSession(2)

    // The turn should resolve with aborted=true
    const result = await turnPromise
    expect(result.aborted).toBe(true)
    expect(sessionManager.hasActiveSession(2)).toBe(false)
  })

  it('reconnects after SDK iterable ends between turns', async () => {
    let queryCallCount = 0

    const firstMessages = [
      { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sess-reconnect' },
      {
        type: 'stream_event',
        session_id: 'sess-reconnect',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'First response' } },
      },
      { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sess-reconnect' },
    ]

    mockSdk.query.mockImplementation(() => {
      queryCallCount++
      if (queryCallCount === 1) {
        let idx = 0
        return {
          [Symbol.asyncIterator]: () => ({
            async next() {
              if (idx < firstMessages.length) {
                return { value: firstMessages[idx++], done: false }
              }
              return { value: undefined, done: true }
            },
          }),
          close: vi.fn(),
        }
      }
      // Reconnect call: block forever (session stays alive)
      return {
        [Symbol.asyncIterator]: () => ({
          async next() {
            return new Promise(() => {})
          },
        }),
        close: vi.fn(),
      }
    })

    const result = await sessionManager.sendTurn(
      10,
      [{ role: 'user', content: 'Hello' }],
      'You are helpful',
      { model: 'claude-sonnet-4-20250514', cwd: '/tmp/test', permissionMode: 'bypassPermissions' } as any,
      null
    )

    expect(result.content).toBe('First response')
    expect(result.sessionId).toBe('sess-reconnect')

    // Wait for reconnection to happen
    await new Promise<void>((r) => setTimeout(r, 50))

    // Session still active after reconnection
    expect(sessionManager.hasActiveSession(10)).toBe(true)
    // SDK query called twice: initial + reconnect
    expect(queryCallCount).toBe(2)
    // Reconnect used resume with session id
    const reconnectCall = mockSdk.query.mock.calls[1][0]
    expect(reconnectCall.options.resume).toBe('sess-reconnect')

    sessionManager.invalidateSession(10)
  })

  it('defers done until background tasks complete and SDK processes results', async () => {
    const streaming = await import('./streaming')
    const sendChunkMock = vi.mocked(streaming.sendChunk)

    // Full flow using SDK native task lifecycle:
    // task_started → turn end (deferred) → task_progress → task_notification →
    // SDK auto-continues (Claude processes results) → new result/success → done
    const sdkMessages: Array<Record<string, unknown>> = [
      { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sess-defer' },
      // Initial text
      {
        type: 'stream_event',
        session_id: 'sess-defer',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Launching agent...' } },
      },
      // Tool start: Task
      {
        type: 'stream_event',
        session_id: 'sess-defer',
        event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool_bg_1', name: 'Task' } },
      },
      // Tool input delta
      {
        type: 'stream_event',
        session_id: 'sess-defer',
        event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"run_in_background":true,"prompt":"do stuff","subagent_type":"general-purpose","description":"bg task"}' } },
      },
      // Tool stop
      {
        type: 'stream_event',
        session_id: 'sess-defer',
        event: { type: 'content_block_stop' },
      },
      // Tool result
      {
        type: 'result',
        subtype: 'tool_result',
        tool_name: 'Task',
        tool_use_id: 'tool_bg_1',
        summary: 'Agent launched',
        content: 'Agent launched in background',
        session_id: 'sess-defer',
      },
      // SDK sends task_started when the background agent actually begins
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-123',
        tool_use_id: 'tool_bg_1',
        description: 'bg task',
        session_id: 'sess-defer',
      },
      // Turn end — deferred because pendingTaskCount > 0
      {
        type: 'result',
        subtype: 'success',
        stop_reason: 'end_turn',
        session_id: 'sess-defer',
      },
    ]

    // After turn end, SDK delivers task lifecycle messages
    const postTurnEndMessages: Array<Record<string, unknown>> = [
      // SDK natural heartbeat: task_progress
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'task-123',
        description: 'bg task',
        last_tool_name: 'Read',
        session_id: 'sess-defer',
      },
      // task_notification: agent completed
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-123',
        status: 'completed',
        summary: 'Background task finished',
        session_id: 'sess-defer',
      },
      // Claude's response after processing the agent results
      {
        type: 'stream_event',
        session_id: 'sess-defer',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' Agent completed successfully.' } },
      },
      // Final turn end — this one sends done (pendingTaskCount is 0)
      {
        type: 'result',
        subtype: 'success',
        stop_reason: 'end_turn',
        session_id: 'sess-defer',
      },
    ]

    let msgIndex = 0
    const allMessages = [...sdkMessages, ...postTurnEndMessages]

    const mockQuery = {
      [Symbol.asyncIterator]: () => ({
        async next() {
          if (msgIndex < sdkMessages.length) {
            return { value: allMessages[msgIndex++], done: false }
          }
          // Small delay to simulate background task completing
          if (msgIndex < allMessages.length) {
            const idx = msgIndex++
            if (idx === sdkMessages.length) {
              await new Promise<void>((r) => setTimeout(r, 30))
            }
            return { value: allMessages[idx], done: false }
          }
          // Block forever after all messages
          return new Promise<{ value: undefined; done: true }>(() => {})
        },
      }),
      close: vi.fn(),
    }

    mockSdk.query.mockReturnValue(mockQuery)
    sendChunkMock.mockClear()

    const result = await sessionManager.sendTurn(
      20,
      [{ role: 'user', content: 'Launch background task' }],
      'You are helpful',
      { model: 'claude-sonnet-4-20250514', cwd: '/tmp/test', permissionMode: 'bypassPermissions' } as any,
      null
    )

    // Turn should have completed with BOTH initial and post-notification content
    expect(result.content).toBe('Launching agent... Agent completed successfully.')
    expect(result.aborted).toBe(false)
    expect(result.sessionId).toBe('sess-defer')

    // Verify ordering: task_notification → done (after Claude processes results)
    const sendChunkCalls = sendChunkMock.mock.calls
    const taskNotifIdx = sendChunkCalls.findIndex((c) => c[0] === 'task_notification')
    const doneIdx = sendChunkCalls.findIndex((c) => c[0] === 'done')
    expect(taskNotifIdx).toBeGreaterThan(-1)
    expect(doneIdx).toBeGreaterThan(-1)
    expect(doneIdx).toBeGreaterThan(taskNotifIdx)

    sessionManager.invalidateSession(20)
  })
})
