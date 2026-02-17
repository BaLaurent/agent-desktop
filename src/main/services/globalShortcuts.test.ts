import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

const mockRegister = vi.fn()
const mockUnregisterAll = vi.fn()

vi.mock('electron', () => ({
  globalShortcut: {
    register: (...args: unknown[]) => mockRegister(...args),
    unregisterAll: () => mockUnregisterAll(),
  },
  app: { getPath: () => '/tmp' },
}))

const mockRegisterWayland = vi.fn().mockResolvedValue(true)
const mockRebindWayland = vi.fn().mockResolvedValue(true)
const mockUnregisterWayland = vi.fn().mockResolvedValue(undefined)

vi.mock('./waylandShortcuts', () => ({
  registerWaylandShortcuts: (...args: unknown[]) => mockRegisterWayland(...args),
  rebindWaylandShortcuts: (...args: unknown[]) => mockRebindWayland(...args),
  unregisterWaylandShortcuts: () => mockUnregisterWayland(),
}))

let mockSessionType: 'wayland' | 'x11' | 'unknown' = 'x11'
vi.mock('../utils/env', () => ({
  getSessionType: () => mockSessionType,
}))

vi.mock('fs', () => ({ appendFileSync: vi.fn() }))
vi.mock('path', () => ({ join: (...parts: string[]) => parts.join('/') }))

// --- Helpers ---

function makeMockDb(keybindings: Record<string, string> = {}) {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT keybinding')) {
        return {
          get: vi.fn((action: string) => {
            const kb = keybindings[action]
            return kb ? { keybinding: kb } : undefined
          }),
        }
      }
      return { get: vi.fn(), run: vi.fn() }
    }),
  }
}

// --- Tests ---

describe('globalShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockSessionType = 'x11'
  })

  describe('X11 path', () => {
    it('registers shortcuts via Electron globalShortcut on X11', async () => {
      mockSessionType = 'x11'
      const { registerGlobalShortcuts, reregister } = await import('./globalShortcuts')
      const db = makeMockDb({ quick_chat: 'Alt+Space', quick_voice: 'Alt+Shift+Space', show_app: 'Super+A' })
      const cbs = { onQuickChat: vi.fn(), onQuickVoice: vi.fn(), onShowApp: vi.fn() }

      registerGlobalShortcuts(db as any, cbs)
      await reregister()

      expect(mockRegister).toHaveBeenCalledWith('Alt+Space', cbs.onQuickChat)
      expect(mockRegister).toHaveBeenCalledWith('Alt+Shift+Space', cbs.onQuickVoice)
      expect(mockRegister).toHaveBeenCalledWith('Super+A', cbs.onShowApp)
    })

    it('unregisters all before re-registering on X11', async () => {
      mockSessionType = 'x11'
      const { registerGlobalShortcuts, reregister } = await import('./globalShortcuts')
      registerGlobalShortcuts(makeMockDb() as any, { onQuickChat: vi.fn(), onQuickVoice: vi.fn(), onShowApp: vi.fn() })

      await reregister()

      expect(mockUnregisterAll).toHaveBeenCalled()
    })

    it('uses default keybindings when DB returns none', async () => {
      mockSessionType = 'x11'
      const { registerGlobalShortcuts, reregister } = await import('./globalShortcuts')
      registerGlobalShortcuts(makeMockDb() as any, { onQuickChat: vi.fn(), onQuickVoice: vi.fn(), onShowApp: vi.fn() })

      await reregister()

      expect(mockRegister).toHaveBeenCalledWith('Alt+Space', expect.any(Function))
      expect(mockRegister).toHaveBeenCalledWith('Alt+Shift+Space', expect.any(Function))
      expect(mockRegister).toHaveBeenCalledWith('Super+A', expect.any(Function))
    })
  })

  describe('Wayland path', () => {
    it('uses full registration on first call', async () => {
      mockSessionType = 'wayland'
      const { registerGlobalShortcuts, reregister } = await import('./globalShortcuts')
      registerGlobalShortcuts(makeMockDb() as any, { onQuickChat: vi.fn(), onQuickVoice: vi.fn(), onShowApp: vi.fn() })

      // Wait for the implicit fire-and-forget reregister() to complete via the lock
      // by calling reregister() which awaits the lock first
      const lockPromise = reregister()
      // Clear the rebind mock BEFORE the second call runs, so we can assert the first was full registration
      // Actually, the lock serializes: implicit call finishes, then our call runs.
      // The implicit call is the first — it does full registration.
      await lockPromise

      // Implicit call did full registration; our call did rebind.
      // Verify full registration was called at least once:
      expect(mockRegisterWayland).toHaveBeenCalledTimes(1)
    })

    it('uses rebind (fast path) on subsequent calls when session active', async () => {
      mockSessionType = 'wayland'
      const { registerGlobalShortcuts, reregister } = await import('./globalShortcuts')
      registerGlobalShortcuts(makeMockDb() as any, { onQuickChat: vi.fn(), onQuickVoice: vi.fn(), onShowApp: vi.fn() })

      // registerGlobalShortcuts fires reregister() internally (fire-and-forget).
      // Our explicit await reregister() waits for that, then runs a second doReregister.
      // Call 1 (implicit): full registration → waylandActive = true
      // Call 2 (explicit): waylandActive = true → rebind
      await reregister()
      expect(mockRegisterWayland).toHaveBeenCalledTimes(1)
      expect(mockRebindWayland).toHaveBeenCalledTimes(1)
    })

    it('falls back to full registration when rebind fails', async () => {
      mockSessionType = 'wayland'
      mockRebindWayland.mockResolvedValueOnce(false)
      const { registerGlobalShortcuts, reregister } = await import('./globalShortcuts')
      registerGlobalShortcuts(makeMockDb() as any, { onQuickChat: vi.fn(), onQuickVoice: vi.fn(), onShowApp: vi.fn() })

      // Call 1 (implicit): full registration → waylandActive = true
      // Call 2 (explicit): rebind returns false → falls through to full registration
      await reregister()
      expect(mockRebindWayland).toHaveBeenCalledTimes(1)
      expect(mockRegisterWayland).toHaveBeenCalledTimes(2)
    })

    it('passes updated keybindings to rebind', async () => {
      mockSessionType = 'wayland'
      const db = makeMockDb({ quick_chat: 'Ctrl+Space', quick_voice: 'Ctrl+Shift+Space', show_app: 'Super+B' })
      const { registerGlobalShortcuts, reregister } = await import('./globalShortcuts')
      registerGlobalShortcuts(db as any, { onQuickChat: vi.fn(), onQuickVoice: vi.fn(), onShowApp: vi.fn() })

      // Call 1 (implicit): full registration
      // Call 2 (explicit): rebind with updated keys
      await reregister()

      expect(mockRebindWayland).toHaveBeenCalledWith([
        { id: 'quick-chat', accelerator: 'Ctrl+Space' },
        { id: 'quick-voice', accelerator: 'Ctrl+Shift+Space' },
        { id: 'show-app', accelerator: 'Super+B' },
      ])
    })
  })

  describe('unregisterAll', () => {
    it('unregisters Wayland shortcuts when active', async () => {
      mockSessionType = 'wayland'
      const { registerGlobalShortcuts, reregister, unregisterAll } = await import('./globalShortcuts')
      registerGlobalShortcuts(makeMockDb() as any, { onQuickChat: vi.fn(), onQuickVoice: vi.fn(), onShowApp: vi.fn() })

      await reregister()
      await unregisterAll()

      expect(mockUnregisterWayland).toHaveBeenCalled()
    })
  })
})
