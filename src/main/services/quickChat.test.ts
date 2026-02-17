import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMain } from 'electron'

// --- Mocks ---

let didFinishLoadCb: (() => void) | null = null
let closedCb: (() => void) | null = null

const mockWebContents = {
  send: vi.fn(),
  once: vi.fn((event: string, cb: () => void) => {
    if (event === 'did-finish-load') didFinishLoadCb = cb
  }),
}

const mockOverlayWin = {
  loadURL: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  hide: vi.fn(),
  destroy: vi.fn(),
  isDestroyed: vi.fn(() => false),
  isVisible: vi.fn(() => false),
  setBounds: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  on: vi.fn((event: string, cb: () => void) => {
    if (event === 'closed') closedCb = cb
  }),
  webContents: mockWebContents,
}

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function () { return mockOverlayWin }),
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
  },
  ipcMain: { handle: vi.fn() },
}))

vi.mock('./streaming', () => ({
  registerStreamWindow: vi.fn(),
}))

vi.mock('./globalShortcuts', () => ({
  reregister: vi.fn(),
}))

vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => null),
}))

// --- Helpers ---

function makeMockDb(overrides: Record<string, any> = {}) {
  const store: Record<string, string | undefined> = {
    'quickChat_conversationId': undefined,
    'quickChat_voiceConversationId': undefined,
    'quickChat_separateVoiceConversation': undefined,
    'quickChat_voiceHeadless': undefined,
    'ai_model': undefined,
    ...overrides,
  }

  const insertedConversations: number[] = []
  let nextId = 42

  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT value FROM settings WHERE key =')) {
        return {
          get: vi.fn((key?: any) => {
            const k = key ?? sql.match(/'([^']+)'/)?.[1]
            const val = store[k as string]
            return val !== undefined ? { value: String(val) } : undefined
          }),
        }
      }
      if (sql.includes('SELECT 1 FROM conversations')) {
        return {
          get: vi.fn((id?: number) => {
            // If id was inserted or is in the store, it exists
            if (id && insertedConversations.includes(id)) return { 1: 1 }
            // Check if it matches a stored conversation id
            const textId = store['quickChat_conversationId']
            const voiceId = store['quickChat_voiceConversationId']
            if (id && (String(id) === textId || String(id) === voiceId)) return { 1: 1 }
            return undefined
          }),
        }
      }
      if (sql.includes('INSERT INTO conversations')) {
        return {
          run: vi.fn(() => {
            const id = nextId++
            insertedConversations.push(id)
            return { lastInsertRowid: id }
          }),
        }
      }
      if (sql.includes('INSERT OR REPLACE INTO settings')) {
        return {
          run: vi.fn((...args: any[]) => {
            // Track setting writes: args are (key, value) for parameterized query
            if (args.length >= 2) {
              store[args[0]] = args[1]
            }
          }),
        }
      }
      if (sql.includes('DELETE FROM messages')) {
        return { run: vi.fn() }
      }
      return { get: vi.fn(), run: vi.fn() }
    }),
    _store: store,
    _insertedConversations: insertedConversations,
  } as any
}

// --- Tests ---

describe('QuickChat Service', () => {
  let mockIpcMain: { handle: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    didFinishLoadCb = null
    closedCb = null
    mockOverlayWin.isDestroyed.mockReturnValue(false)
    mockOverlayWin.isVisible.mockReturnValue(false)
    mockIpcMain = { handle: vi.fn() }
  })

  describe('registerHandlers', () => {
    it('registers all IPC handlers', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb()
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const channels = mockIpcMain.handle.mock.calls.map((c: any[]) => c[0])
      expect(channels).toContain('quickChat:getConversationId')
      expect(channels).toContain('quickChat:purge')
      expect(channels).toContain('quickChat:hide')
      expect(channels).toContain('quickChat:setBubbleMode')
      expect(channels).toContain('quickChat:reregisterShortcuts')
    })
  })

  describe('ensureConversation via IPC', () => {
    it('returns same conversation for text and voice when separate=false', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({ 'quickChat_separateVoiceConversation': 'false' })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      const textId = await handler({}, 'text')
      const voiceId = await handler({}, 'voice')

      expect(textId).toBe(voiceId)
    })

    it('creates separate conversation for voice when separate=true', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({ 'quickChat_separateVoiceConversation': 'true' })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      const textId = await handler({}, 'text')
      const voiceId = await handler({}, 'voice')

      expect(textId).not.toBe(voiceId)
    })

    it('voice conversation has "(Voice)" in title when separate=true', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({ 'quickChat_separateVoiceConversation': 'true' })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      // Call voice first to trigger conversation creation
      await handler({}, 'voice')

      // Find the INSERT INTO conversations call with voice title
      const insertCalls = db.prepare.mock.calls.filter(
        (c: any[]) => c[0].includes('INSERT INTO conversations')
      )
      expect(insertCalls.length).toBeGreaterThan(0)
    })

    it('purge clears both text and voice conversations', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({
        'quickChat_separateVoiceConversation': 'true',
        'quickChat_conversationId': '10',
        'quickChat_voiceConversationId': '20',
      })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const purgeHandler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:purge'
      )?.[1]

      await purgeHandler({})

      // Should have called DELETE FROM messages for both IDs
      const deleteCalls = db.prepare.mock.calls.filter(
        (c: any[]) => c[0].includes('DELETE FROM messages')
      )
      expect(deleteCalls.length).toBe(2)
    })

    it('purge does not double-delete when text and voice share same conversation', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({
        'quickChat_conversationId': '10',
        'quickChat_voiceConversationId': '10',
      })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const purgeHandler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:purge'
      )?.[1]

      await purgeHandler({})

      // voiceId === textId → only one DELETE
      const deleteCalls = db.prepare.mock.calls.filter(
        (c: any[]) => c[0].includes('DELETE FROM messages')
      )
      expect(deleteCalls.length).toBe(1)
    })
  })

  describe('showOverlay', () => {
    it('creates overlay window with did-finish-load listener for text mode', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      showOverlay('text')

      // did-finish-load listener registered (not ready-to-show)
      expect(mockWebContents.once).toHaveBeenCalledWith('did-finish-load', expect.any(Function))
      expect(mockOverlayWin.loadURL).toHaveBeenCalledWith(
        expect.stringContaining('mode=overlay&voice=false&headless=false')
      )
    })

    it('shows and focuses window when did-finish-load fires', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      showOverlay('text')

      expect(mockOverlayWin.show).not.toHaveBeenCalled()

      // Simulate page load complete
      didFinishLoadCb?.()

      expect(mockOverlayWin.show).toHaveBeenCalled()
      expect(mockOverlayWin.focus).toHaveBeenCalled()
    })

    it('hides visible overlay on second text trigger', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      showOverlay('text')
      mockOverlayWin.isVisible.mockReturnValue(true)

      showOverlay('text')

      expect(mockOverlayWin.hide).toHaveBeenCalled()
    })

    it('sends stopRecording on second voice trigger when visible', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      showOverlay('voice')
      mockOverlayWin.isVisible.mockReturnValue(true)

      showOverlay('voice')

      expect(mockWebContents.send).toHaveBeenCalledWith('overlay:stopRecording')
    })

    it('destroys stale invisible overlay and creates new one', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      // First call creates overlay
      showOverlay('text')

      // Overlay exists but not visible (e.g. previous did-finish-load never fired)
      mockOverlayWin.isVisible.mockReturnValue(false)

      showOverlay('text')

      expect(mockOverlayWin.destroy).toHaveBeenCalled()
    })

    it('skips did-finish-load listener for headless voice mode', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb({
        'quickChat_voiceHeadless': 'true',
      }))

      mockWebContents.once.mockClear()
      showOverlay('voice')

      expect(mockWebContents.once).not.toHaveBeenCalledWith('did-finish-load', expect.any(Function))
      expect(mockOverlayWin.loadURL).toHaveBeenCalledWith(
        expect.stringContaining('headless=true')
      )
    })
  })

  describe('hideOverlay', () => {
    it('destroys the overlay window', async () => {
      const { registerHandlers, showOverlay, hideOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      showOverlay('text')
      hideOverlay()

      expect(mockOverlayWin.destroy).toHaveBeenCalled()
    })

    it('does nothing if no overlay exists', async () => {
      const { hideOverlay } = await import('./quickChat')
      // Should not throw
      hideOverlay()
    })
  })
})
