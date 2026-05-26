import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initMemoryAdapter, SqlJsAdapter } from '../db/sqljs-adapter'
import { createTables } from '../db/schema'
import { seedDefaults } from '../db/seed'
import { DispatchRegistry } from '../dispatch'
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import type { Broadcaster } from '../ports/broadcaster'
import type { HookRunner } from '../ports/hookRunner'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/test-agent'),
    commandLine: { appendSwitch: vi.fn() },
  },
}))

const { _loadAgentSDK } = vi.hoisted(() => ({ _loadAgentSDK: vi.fn() }))
vi.mock('../services/anthropic', () => ({ loadAgentSDK: _loadAgentSDK }))

const mockStreamMessage = vi.fn().mockResolvedValue({ content: 'AI response', toolCalls: [], aborted: false, sessionId: null })
vi.mock('../services/streaming', () => ({
  streamMessage: (...args: unknown[]) => mockStreamMessage(...args),
  abortStream: vi.fn(),
  injectApiKeyEnv: vi.fn(() => null),
  notifyConversationUpdated: vi.fn(),
  sendChunk: vi.fn(),
  respondToApproval: vi.fn(),
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return { ...actual, mkdirSync: vi.fn(), readdirSync: vi.fn(() => []), writeFileSync: vi.fn() }
})

import { registerMessagesHandlers } from './messages'
import { abortStream } from '../services/streaming'
import { loadAgentSDK } from '../services/anthropic'
import type { MessagesHandlerOptions } from './messages'

const mockLoadAgentSDK = loadAgentSDK as ReturnType<typeof vi.fn>

const mockRunHooks = vi.fn().mockResolvedValue([])
const testHookRunner: HookRunner = {
  runUserPromptSubmitHooks: (...args: Parameters<HookRunner['runUserPromptSubmitHooks']>) => mockRunHooks(...args),
}

async function createTestDb() {
  const db = await initMemoryAdapter()
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createTables(db as any)
  seedDefaults(db as any)
  return db
}

function createMockIpcMain() {
  const registry = new DispatchRegistry()
  return {
    registry,
    handle: registry.handle.bind(registry),
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = registry.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler(...args)
    },
  }
}

function createTestOptions(overrides?: Partial<MessagesHandlerOptions>): MessagesHandlerOptions {
  const broadcaster: Broadcaster = { broadcast: () => {} }
  return {
    broadcaster,
    hookRunner: testHookRunner,
    sessionsBase: pathJoin(tmpdir(), 'agent-test-sessions'),
    ...overrides,
  }
}

describe('messages integration', () => {
  let db: SqlJsAdapter
  let ipc: ReturnType<typeof createMockIpcMain>
  let convId: number

  beforeEach(async () => {
    db = await createTestDb()
    ipc = createMockIpcMain()
    registerMessagesHandlers(ipc.registry, db, createTestOptions())
    mockStreamMessage.mockReset()
    mockStreamMessage.mockResolvedValue({ content: 'AI response', toolCalls: [], aborted: false, sessionId: null })
    mockRunHooks.mockReset()
    mockRunHooks.mockResolvedValue([])

    // Create a conversation
    const result = db
      .prepare("INSERT INTO conversations (title) VALUES ('Test')")
      .run()
    convId = result.lastInsertRowid as number
  })

  afterEach(() => {
    db.close()
  })

  it('messages:send saves user message and returns assistant message', async () => {
    const result = await ipc.invoke('messages:send', convId, 'Hello')

    expect(result).toBeTruthy()
    expect((result as { content: string }).content).toBe('AI response')

    const msgs = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at')
      .all(convId) as { role: string; content: string }[]

    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content).toBe('Hello')
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].content).toBe('AI response')
  })

  it('messages:send with stream returning no content returns null', async () => {
    mockStreamMessage.mockResolvedValueOnce({ content: '', toolCalls: [], aborted: false, sessionId: null })

    const result = await ipc.invoke('messages:send', convId, 'Hello')

    expect(result).toBeNull()

    const msgs = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ?')
      .all(convId) as { role: string }[]

    // Only user message saved
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
  })

  it('messages:regenerate deletes last assistant and re-streams', async () => {
    // Seed messages
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Hi', '[]', ?, ?)"
    ).run(convId, now, now)
    const later = new Date(Date.now() + 1000).toISOString()
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'assistant', 'Old reply', '[]', ?, ?)"
    ).run(convId, later, later)

    mockStreamMessage.mockResolvedValueOnce({ content: 'New reply', toolCalls: [], aborted: false, sessionId: null })

    const result = await ipc.invoke('messages:regenerate', convId)

    expect(result).toBeTruthy()
    expect((result as { content: string }).content).toBe('New reply')

    const msgs = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at')
      .all(convId) as { role: string; content: string }[]

    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe('Hi')
    expect(msgs[1].content).toBe('New reply')
  })

  it('messages:edit updates content and deletes subsequent messages then re-streams', async () => {
    const t1 = '2024-01-01T00:00:00.000Z'
    const t2 = '2024-01-01T00:00:01.000Z'
    const t3 = '2024-01-01T00:00:02.000Z'

    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Original', '[]', ?, ?)"
    ).run(convId, t1, t1)
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'assistant', 'Reply', '[]', ?, ?)"
    ).run(convId, t2, t2)
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Follow up', '[]', ?, ?)"
    ).run(convId, t3, t3)

    const userMsg = db
      .prepare("SELECT id FROM messages WHERE conversation_id = ? AND content = 'Original'")
      .get(convId) as { id: number }

    mockStreamMessage.mockResolvedValueOnce({ content: 'New AI reply', toolCalls: [], aborted: false, sessionId: null })

    await ipc.invoke('messages:edit', userMsg.id, 'Edited')

    const msgs = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at')
      .all(convId) as { role: string; content: string }[]

    expect(msgs[0].content).toBe('Edited')
    // Subsequent messages after the edited one should be deleted, new assistant added
    const assistantMsgs = msgs.filter((m) => m.role === 'assistant')
    expect(assistantMsgs[assistantMsgs.length - 1].content).toBe('New AI reply')
  })

  it('messages:send passes conversationId and null sdkSessionId to streamMessage', async () => {
    await ipc.invoke('messages:send', convId, 'Hello')
    expect(mockStreamMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      convId,
      null
    )
  })

  it('messages:send passes sdkSessionId when conversation has one', async () => {
    db.prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?').run('session-resume-test', convId)

    await ipc.invoke('messages:send', convId, 'Follow-up')
    expect(mockStreamMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      convId,
      'session-resume-test'
    )
  })

  it('messages:send saves returned sessionId to conversation', async () => {
    mockStreamMessage.mockResolvedValueOnce({ content: 'Reply', toolCalls: [], aborted: false, sessionId: 'new-session-id-abc' })

    await ipc.invoke('messages:send', convId, 'Hello')

    const conv = db.prepare('SELECT sdk_session_id FROM conversations WHERE id = ?').get(convId) as { sdk_session_id: string | null }
    expect(conv.sdk_session_id).toBe('new-session-id-abc')
  })

  it('messages:regenerate clears sdkSessionId and passes null to streamMessage', async () => {
    // Set a session ID first
    db.prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?').run('old-session', convId)

    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Hi', '[]', ?, ?)"
    ).run(convId, now, now)
    const later = new Date(Date.now() + 1000).toISOString()
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'assistant', 'Old', '[]', ?, ?)"
    ).run(convId, later, later)

    await ipc.invoke('messages:regenerate', convId)

    // Session should be cleared before streaming
    const conv = db.prepare('SELECT sdk_session_id FROM conversations WHERE id = ?').get(convId) as { sdk_session_id: string | null }
    expect(conv.sdk_session_id).toBeNull()
    expect(mockStreamMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      convId,
      null
    )
  })

  it('messages:edit clears sdkSessionId and passes null to streamMessage', async () => {
    // Set a session ID first
    db.prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?').run('edit-session', convId)

    const t1 = '2024-01-01T00:00:00.000Z'
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Original', '[]', ?, ?)"
    ).run(convId, t1, t1)
    const userMsg = db
      .prepare("SELECT id FROM messages WHERE conversation_id = ? AND content = 'Original'")
      .get(convId) as { id: number }

    await ipc.invoke('messages:edit', userMsg.id, 'Edited')

    // Session should be cleared before streaming
    const conv = db.prepare('SELECT sdk_session_id FROM conversations WHERE id = ?').get(convId) as { sdk_session_id: string | null }
    expect(conv.sdk_session_id).toBeNull()
    expect(mockStreamMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      expect.any(Number),
      null
    )
  })

  it('messages:regenerate updates conversation updated_at', async () => {
    const oldTimestamp = '2024-01-01T00:00:00.000Z'
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(oldTimestamp, convId)

    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Hi', '[]', ?, ?)"
    ).run(convId, now, now)
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'assistant', 'Old', '[]', ?, ?)"
    ).run(convId, now, now)

    await ipc.invoke('messages:regenerate', convId)

    const conv = db.prepare('SELECT updated_at FROM conversations WHERE id = ?').get(convId) as { updated_at: string }
    expect(conv.updated_at > oldTimestamp).toBe(true)
  })

  it('messages:edit updates conversation updated_at', async () => {
    const oldTimestamp = '2024-01-01T00:00:00.000Z'
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(oldTimestamp, convId)

    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Original', '[]', ?, ?)"
    ).run(convId, oldTimestamp, oldTimestamp)
    const userMsg = db
      .prepare("SELECT id FROM messages WHERE conversation_id = ? AND content = 'Original'")
      .get(convId) as { id: number }

    await ipc.invoke('messages:edit', userMsg.id, 'Edited')

    const conv = db.prepare('SELECT updated_at FROM conversations WHERE id = ?').get(convId) as { updated_at: string }
    expect(conv.updated_at > oldTimestamp).toBe(true)
  })

  it('messages:stop calls abortStream', async () => {
    await ipc.invoke('messages:stop')
    expect(abortStream).toHaveBeenCalled()
  })

  describe('cleared_at context boundary', () => {
    it('buildMessageHistory excludes messages before cleared_at', async () => {
      const t1 = '2024-01-01T00:00:00.000Z'
      const t2 = '2024-01-01T00:00:01.000Z'
      const t3 = '2024-01-01T00:00:02.000Z'
      const t4 = '2024-01-01T00:00:03.000Z'

      db.prepare(
        "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Old question', '[]', ?, ?)"
      ).run(convId, t1, t1)
      db.prepare(
        "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'assistant', 'Old reply', '[]', ?, ?)"
      ).run(convId, t2, t2)
      db.prepare(
        "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'New question', '[]', ?, ?)"
      ).run(convId, t3, t3)
      db.prepare(
        "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'assistant', 'New reply', '[]', ?, ?)"
      ).run(convId, t4, t4)

      // Set cleared_at between old and new messages
      db.prepare('UPDATE conversations SET cleared_at = ? WHERE id = ?').run(t2, convId)

      // Send a message — buildMessageHistory should exclude old messages
      mockStreamMessage.mockResolvedValueOnce({ content: 'Post-clear reply', toolCalls: [], aborted: false, sessionId: null })
      await ipc.invoke('messages:send', convId, 'After clear')

      // The history passed to streamMessage should only contain messages after cleared_at
      const historyArg = mockStreamMessage.mock.calls[0][0] as { role: string; content: string }[]
      const contents = historyArg.map(m => m.content)
      expect(contents).not.toContain('Old question')
      expect(contents).not.toContain('Old reply')
      expect(contents).toContain('New question')
      expect(contents).toContain('New reply')
      expect(contents).toContain('After clear')
    })

    it('buildMessageHistory returns all messages when cleared_at is null', async () => {
      const t1 = '2024-01-01T00:00:00.000Z'
      db.prepare(
        "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Hello', '[]', ?, ?)"
      ).run(convId, t1, t1)

      mockStreamMessage.mockResolvedValueOnce({ content: 'Reply', toolCalls: [], aborted: false, sessionId: null })
      await ipc.invoke('messages:send', convId, 'World')

      const historyArg = mockStreamMessage.mock.calls[0][0] as { role: string; content: string }[]
      expect(historyArg).toHaveLength(2)
      expect(historyArg[0].content).toBe('Hello')
      expect(historyArg[1].content).toBe('World')
    })
  })

  describe('auto-title generation', () => {
    function mockSDKWithAssistantMessage(text: string) {
      const asyncIter = (async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'text', text }] } }
        yield { type: 'result', subtype: 'success', result: text }
      })()
      mockLoadAgentSDK.mockResolvedValue({ query: () => asyncIter })
    }

    function mockSDKWithEmptyAssistant() {
      const asyncIter = (async function* () {
        yield { type: 'assistant', message: { content: [] } }
        yield { type: 'result', subtype: 'success', result: '' }
      })()
      mockLoadAgentSDK.mockResolvedValue({ query: () => asyncIter })
    }

    function mockSDKWithEmptyIter() {
      const asyncIter = (async function* () {
        // yields nothing
      })()
      mockLoadAgentSDK.mockResolvedValue({ query: () => asyncIter })
    }

    it('sets conversation title from assistant message text', async () => {
      mockSDKWithAssistantMessage('Hello World Chat')

      await ipc.invoke('messages:send', convId, 'Hello')
      // generateConversationTitle is fire-and-forget — wait for it
      await new Promise((r) => setTimeout(r, 50))

      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convId) as { title: string }
      expect(conv.title).toBe('Hello World Chat')
    })

    it('extracts title from result string on success', async () => {
      const asyncIter = (async function* () {
        yield { type: 'result', subtype: 'success', result: 'Title From Result' }
      })()
      mockLoadAgentSDK.mockResolvedValue({ query: () => asyncIter })

      await ipc.invoke('messages:send', convId, 'Hello')
      await new Promise((r) => setTimeout(r, 50))

      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convId) as { title: string }
      expect(conv.title).toBe('Title From Result')
    })

    it('extracts title from assistant message even on error_max_turns', async () => {
      const asyncIter = (async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Extracted Title' }] } }
        yield { type: 'result', subtype: 'error_max_turns' }
      })()
      mockLoadAgentSDK.mockResolvedValue({ query: () => asyncIter })

      await ipc.invoke('messages:send', convId, 'Hello')
      await new Promise((r) => setTimeout(r, 50))

      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convId) as { title: string }
      expect(conv.title).toBe('Extracted Title')
    })

    it('does not trigger auto-title on second assistant message', async () => {
      // Pre-seed first exchange
      const t1 = '2024-06-01T00:00:00.000Z'
      const t2 = '2024-06-01T00:00:01.000Z'
      db.prepare(
        "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'First', '[]', ?, ?)"
      ).run(convId, t1, t1)
      db.prepare(
        "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'assistant', 'First reply', '[]', ?, ?)"
      ).run(convId, t2, t2)

      mockSDKWithAssistantMessage('Should Not Appear')

      await ipc.invoke('messages:send', convId, 'Second question')
      await new Promise((r) => setTimeout(r, 50))

      // Title unchanged — auto-title only fires when assistantCount === 1
      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convId) as { title: string }
      expect(conv.title).toBe('Test')
    })

    it('does not update title when assistant has no text content', async () => {
      mockSDKWithEmptyAssistant()

      await ipc.invoke('messages:send', convId, 'Hello')
      await new Promise((r) => setTimeout(r, 50))

      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convId) as { title: string }
      expect(conv.title).toBe('Test') // unchanged
    })

    it('does not update title when SDK yields no messages', async () => {
      mockSDKWithEmptyIter()

      await ipc.invoke('messages:send', convId, 'Hello')
      await new Promise((r) => setTimeout(r, 50))

      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convId) as { title: string }
      expect(conv.title).toBe('Test') // unchanged
    })

    it('strips quotes from title', async () => {
      mockSDKWithAssistantMessage('"Quoted Title"')

      await ipc.invoke('messages:send', convId, 'Hello')
      await new Promise((r) => setTimeout(r, 50))

      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convId) as { title: string }
      expect(conv.title).toBe('Quoted Title')
    })

    it('strips hook system message tags from assistant content before generating title', async () => {
      // Simulate hooks returning a system message
      mockRunHooks.mockResolvedValue([{ content: 'Lint OK', hookEvent: 'UserPromptSubmit' }])

      let capturedPrompt = ''
      const asyncIter = (async function* () {
        yield { type: 'result', subtype: 'success', result: 'Hook-Free Title' }
      })()
      mockLoadAgentSDK.mockResolvedValue({
        query: (opts: { prompt: string }) => {
          capturedPrompt = opts.prompt
          return asyncIter
        },
      })

      await ipc.invoke('messages:send', convId, 'Hello')
      await new Promise((r) => setTimeout(r, 50))

      // Title should be set
      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convId) as { title: string }
      expect(conv.title).toBe('Hook-Free Title')

      // The prompt sent to SDK should NOT contain hook-system-message tags
      expect(capturedPrompt).not.toContain('hook-system-message')
      expect(capturedPrompt).not.toContain('Lint OK')
      // But it should contain the actual assistant response
      expect(capturedPrompt).toContain('AI response')
    })

    it('trims whitespace and truncates title to 80 chars', async () => {
      const longTitle = '  ' + 'A'.repeat(100) + '  '
      mockSDKWithAssistantMessage(longTitle)

      await ipc.invoke('messages:send', convId, 'Hello')
      await new Promise((r) => setTimeout(r, 50))

      const conv = db.prepare('SELECT title FROM conversations WHERE id = ?').get(convId) as { title: string }
      expect(conv.title).toHaveLength(80)
      expect(conv.title).toBe('A'.repeat(80))
    })
  })

  it('messages:send saves a stopped partial when aborted with content', async () => {
    const onTtsSpeak = vi.fn()
    const onSessionInvalidate = vi.fn()
    const ipc2 = createMockIpcMain()
    registerMessagesHandlers(ipc2.registry, db, createTestOptions({ onTtsSpeak, onSessionInvalidate }))
    db.prepare("UPDATE conversations SET sdk_session_id = 'sess-1' WHERE id = ?").run(convId)

    mockStreamMessage.mockResolvedValueOnce({ content: 'partial answer', toolCalls: [], aborted: true, sessionId: null })

    const result = await ipc2.invoke('messages:send', convId, 'Hello')

    const msgs = db
      .prepare('SELECT role, content, stopped FROM messages WHERE conversation_id = ? ORDER BY created_at')
      .all(convId) as { role: string; content: string; stopped: number }[]

    expect(msgs).toHaveLength(2)
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].content).toBe('partial answer')
    expect(msgs[1].stopped).toBe(1)
    expect(result).toBeTruthy()

    const conv = db.prepare('SELECT sdk_session_id FROM conversations WHERE id = ?').get(convId) as { sdk_session_id: string | null }
    expect(conv.sdk_session_id).toBeNull()

    expect(onSessionInvalidate).toHaveBeenCalledWith(convId)
    expect(onTtsSpeak).not.toHaveBeenCalled()
  })

  it('messages:send saves tool calls on a stopped turn', async () => {
    mockStreamMessage.mockResolvedValueOnce({
      content: '',
      toolCalls: [{ id: 't1', name: 'Bash', input: '{}', output: '', status: 'done' }],
      aborted: true,
      sessionId: null,
    })

    await ipc.invoke('messages:send', convId, 'Hello')

    const msgs = db
      .prepare('SELECT role, stopped, tool_calls FROM messages WHERE conversation_id = ? ORDER BY created_at')
      .all(convId) as { role: string; stopped: number; tool_calls: string | null }[]

    expect(msgs).toHaveLength(2)
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].stopped).toBe(1)
    expect(msgs[1].tool_calls).not.toBeNull()
    expect(msgs[1].tool_calls).toContain('Bash')
  })

  it('messages:send saves nothing when aborted with no content', async () => {
    mockStreamMessage.mockResolvedValueOnce({ content: '', toolCalls: [], aborted: true, sessionId: null })

    const result = await ipc.invoke('messages:send', convId, 'Hello')

    expect(result).toBeNull()
    const msgs = db.prepare('SELECT role FROM messages WHERE conversation_id = ?').all(convId) as { role: string }[]
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
  })
})
