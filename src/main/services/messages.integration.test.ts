import Database from 'better-sqlite3'
import { createTables } from '../db/schema'
import { seedDefaults } from '../db/seed'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-agent'),
    commandLine: { appendSwitch: vi.fn() },
  },
}))

vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('./anthropic', () => ({
  loadAgentSDK: vi.fn(),
}))

const mockStreamMessage = vi.fn().mockResolvedValue({ content: 'AI response' })
vi.mock('./streaming', () => ({
  streamMessage: (...args: unknown[]) => mockStreamMessage(...args),
  abortStream: vi.fn(),
  injectApiKeyEnv: vi.fn(() => null),
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return { ...actual, mkdirSync: vi.fn(), readdirSync: vi.fn(() => []), writeFileSync: vi.fn() }
})

import { registerHandlers } from './messages'
import { abortStream } from './streaming'
import { loadAgentSDK } from './anthropic'

const mockLoadAgentSDK = loadAgentSDK as ReturnType<typeof vi.fn>

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  createTables(db)
  seedDefaults(db)
  return db
}

type HandlerFn = (...args: unknown[]) => Promise<unknown>

function createMockIpcMain() {
  const handlers: Record<string, HandlerFn> = {}
  return {
    handle: (channel: string, handler: HandlerFn) => {
      handlers[channel] = handler
    },
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers[channel]
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler({}, ...args)
    },
  }
}

describe('messages integration', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>
  let convId: number

  beforeEach(() => {
    db = createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as never, db)
    mockStreamMessage.mockReset()
    mockStreamMessage.mockResolvedValue({ content: 'AI response' })

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
    mockStreamMessage.mockResolvedValueOnce({ content: '' })

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

    mockStreamMessage.mockResolvedValueOnce({ content: 'New reply' })

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

    mockStreamMessage.mockResolvedValueOnce({ content: 'New AI reply' })

    await ipc.invoke('messages:edit', userMsg.id, 'Edited')

    const msgs = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at')
      .all(convId) as { role: string; content: string }[]

    expect(msgs[0].content).toBe('Edited')
    // Subsequent messages after the edited one should be deleted, new assistant added
    const assistantMsgs = msgs.filter((m) => m.role === 'assistant')
    expect(assistantMsgs[assistantMsgs.length - 1].content).toBe('New AI reply')
  })

  it('messages:send passes conversationId to streamMessage', async () => {
    await ipc.invoke('messages:send', convId, 'Hello')
    expect(mockStreamMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      convId
    )
  })

  it('messages:regenerate passes conversationId to streamMessage', async () => {
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Hi', '[]', ?, ?)"
    ).run(convId, now, now)
    const later = new Date(Date.now() + 1000).toISOString()
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'assistant', 'Old', '[]', ?, ?)"
    ).run(convId, later, later)

    await ipc.invoke('messages:regenerate', convId)
    expect(mockStreamMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      convId
    )
  })

  it('messages:edit passes conversation_id to streamMessage', async () => {
    const t1 = '2024-01-01T00:00:00.000Z'
    db.prepare(
      "INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, 'user', 'Original', '[]', ?, ?)"
    ).run(convId, t1, t1)
    const userMsg = db
      .prepare("SELECT id FROM messages WHERE conversation_id = ? AND content = 'Original'")
      .get(convId) as { id: number }

    await ipc.invoke('messages:edit', userMsg.id, 'Edited')
    expect(mockStreamMessage).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.any(Object),
      convId
    )
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
      mockStreamMessage.mockResolvedValueOnce({ content: 'Post-clear reply' })
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

      mockStreamMessage.mockResolvedValueOnce({ content: 'Reply' })
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
})
