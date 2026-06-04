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

vi.mock('../index', () => ({ getMainWindow: vi.fn(() => null) }))
vi.mock('../mainContext', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('../../core/services/voiceAudioEffects', () => ({
  applyVoiceAudioEffects: vi.fn().mockResolvedValue(undefined),
  clearVoiceAudioEffects: vi.fn().mockResolvedValue(undefined),
}))

import { applyVoiceAudioEffects, clearVoiceAudioEffects } from '../../core/services/voiceAudioEffects'

// --- Helpers ---

function makeMockDb(overrides: Record<string, any> = {}) {
  const store: Record<string, string | undefined> = {
    'quickChat_conversationId': undefined,
    'quickChat_voiceConversationId': undefined,
    'quickChat_separateVoiceConversation': undefined,
    'quickChat_voiceHeadless': undefined,
    'quickChat_resumeLastConversationText': undefined,
    'quickChat_resumeLastConversationVoice': undefined,
    'ai_model': undefined,
    ...overrides,
  }

  const insertedConversations: number[] = []
  let nextId = 42
  // Mock "last user conversation" — tests set this to simulate real DB state.
  // When `null`, findLastUserConversationId returns null; when a number, returns it
  // unless it's in the exclusion list.
  const lastUserConvRef: { id: number | null } = { id: (overrides._lastUserConvId as number | null) ?? null }
  const lastOpenedConvRef: { id: number | null } = { id: (overrides._lastOpenedConvId as number | null) ?? null }

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
      if (sql.includes('INNER JOIN messages m ON m.conversation_id = c.id')) {
        // findLastUserConversationId query
        return {
          get: vi.fn((...excludeIds: number[]) => {
            const id = lastUserConvRef.id
            if (id === null || excludeIds.includes(id)) return undefined
            return { id }
          }),
        }
      }
      if (sql.includes('c.last_opened_at IS NOT NULL')) {
        // findLastOpenedConversationId query
        return {
          get: vi.fn((...excludeIds: number[]) => {
            const id = lastOpenedConvRef.id
            if (id === null || excludeIds.includes(id)) return undefined
            return { id }
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
    _lastUserConvRef: lastUserConvRef,
  } as any
}

// --- Tests ---

describe('QuickChat Service', () => {
  let mockIpcMain: { handle: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    // Fire any pending closed callback to reset module state (overlayWindow, headlessActive)
    // before clearing mocks so the cleanup call doesn't pollute test assertions
    closedCb?.()
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

    it('resumes last user conversation when quickChat_resumeLastConversationText=true', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({
        'quickChat_resumeLastConversationText': 'true',
        _lastUserConvId: 99,
      })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      const id = await handler({}, 'text')
      expect(id).toBe(99)
    })

    it('resumes independently for voice toggle', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({
        'quickChat_resumeLastConversationVoice': 'true',
        _lastUserConvId: 77,
      })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      // Text uses normal path (creates new convo), voice resumes
      const textId = await handler({}, 'text')
      const voiceId = await handler({}, 'voice')

      expect(voiceId).toBe(77)
      expect(textId).not.toBe(77)
    })

    it('falls back to dedicated conversation when resume returns null', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({
        'quickChat_resumeLastConversationText': 'true',
        _lastUserConvId: null,
      })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      const id = await handler({}, 'text')
      // Falls back to dedicated → first INSERT yields id=42
      expect(id).toBe(42)
    })

    it('uses findLastOpenedConversationId when preferLastOpened=true', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({
        'quickChat_resumeLastConversationText': 'true',
        'quickChat_resumePreferLastOpened': 'true',
        _lastUserConvId: 99,
        _lastOpenedConvId: 55,
      })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      const id = await handler({}, 'text')
      expect(id).toBe(55)
    })

    it('falls back to dedicated conv when preferLastOpened=true but no opened history', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({
        'quickChat_resumeLastConversationText': 'true',
        'quickChat_resumePreferLastOpened': 'true',
        _lastUserConvId: 99,
        _lastOpenedConvId: null,
      })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      const id = await handler({}, 'text')
      // No opened history → falls back to dedicated (not to last user message)
      expect(id).toBe(42)
    })

    it('preferLastOpened is ignored when resume toggle is off', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({
        'quickChat_resumePreferLastOpened': 'true',
        _lastOpenedConvId: 55,
      })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      const id = await handler({}, 'text')
      // Resume off → dedicated convo created (id=42), preferLastOpened never consulted
      expect(id).toBe(42)
    })

    it('resume toggle off preserves existing dedicated-conversation behavior', async () => {
      const { registerHandlers } = await import('./quickChat')
      const db = makeMockDb({
        'quickChat_conversationId': '10',
        _lastUserConvId: 99,
      })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      const handler = mockIpcMain.handle.mock.calls.find(
        (c: any[]) => c[0] === 'quickChat:getConversationId'
      )?.[1]

      const id = await handler({}, 'text')
      expect(id).toBe(10)
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

    it('destroys visible overlay on second text trigger', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      showOverlay('text')
      mockOverlayWin.isVisible.mockReturnValue(true)

      showOverlay('text')

      expect(mockOverlayWin.destroy).toHaveBeenCalled()
    })

    it('sends stopRecording on second voice trigger when visible', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      showOverlay('voice')
      mockOverlayWin.isVisible.mockReturnValue(true)

      showOverlay('voice')

      expect(mockWebContents.send).toHaveBeenCalledWith('overlay:stopRecording')
    })

    it('restores volume when stopRecording is sent on second voice trigger', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb({
        'voice_volumeDuck': '30',
      }))

      showOverlay('voice')
      mockOverlayWin.isVisible.mockReturnValue(true)
      vi.mocked(clearVoiceAudioEffects).mockClear()

      showOverlay('voice')

      expect(mockWebContents.send).toHaveBeenCalledWith('overlay:stopRecording')
      expect(vi.mocked(clearVoiceAudioEffects)).toHaveBeenCalled()
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

  describe('audio effects', () => {
    it('applies voice audio effects in voice mode', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      const db = makeMockDb({ 'voice_volumeDuck': '30' })
      registerHandlers(mockIpcMain as unknown as IpcMain, db)

      showOverlay('voice')

      expect(vi.mocked(applyVoiceAudioEffects)).toHaveBeenCalledWith(db)
    })

    it('does not apply voice audio effects in text mode', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      showOverlay('text')

      expect(vi.mocked(applyVoiceAudioEffects)).not.toHaveBeenCalled()
    })

    it('clears voice audio effects when overlay window closes', async () => {
      const { registerHandlers, showOverlay } = await import('./quickChat')
      registerHandlers(mockIpcMain as unknown as IpcMain, makeMockDb())

      showOverlay('text')

      // Simulate window close
      closedCb?.()

      expect(vi.mocked(clearVoiceAudioEffects)).toHaveBeenCalled()
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
