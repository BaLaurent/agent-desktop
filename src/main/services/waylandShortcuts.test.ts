import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

let mockExecFileCb: ((err: Error | null, stdout: string) => void) | null = null
const mockExecFile = vi.fn((_bin: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string) => void) => {
  mockExecFileCb = cb
  // Auto-succeed by default
  cb(null, 'ok')
})
const mockExecFileSync = vi.fn(() => '')

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args as [string, string[], object, (err: Error | null, stdout: string) => void]),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args as [string, string[]]),
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}))

// Track fs operations for FIFO testing
const mockAppendFileSync = vi.fn()
const mockUnlinkSync = vi.fn()
const mockOpenSync = vi.fn(() => 42) // fake fd
const mockCloseSync = vi.fn()
const mockCreateReadStream = vi.fn(() => ({
  on: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('fs', () => ({
  appendFileSync: (...args: unknown[]) => mockAppendFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  openSync: (...args: unknown[]) => mockOpenSync(...args),
  closeSync: (...args: unknown[]) => mockCloseSync(...args),
  createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
  constants: { O_RDWR: 2, O_NONBLOCK: 2048 },
}))

vi.mock('path', () => ({ join: (...parts: string[]) => parts.join('/') }))

// Mock findBinaryInPath to return a fake hyprctl path
vi.mock('../utils/env', () => ({
  findBinaryInPath: (name: string) => name === 'hyprctl' ? '/usr/bin/hyprctl' : null,
}))

// Mock dbus-next — return a fake bus that simulates connection
const mockBusCall = vi.fn().mockResolvedValue(undefined)
const mockBusDisconnect = vi.fn()
const mockBusOn = vi.fn()
const mockBusOnce = vi.fn((_event: string, cb: () => void) => cb())
const mockBusRemoveListener = vi.fn()

const mockGetInterface = vi.fn(() => ({
  CreateSession: vi.fn().mockResolvedValue(undefined),
  BindShortcuts: vi.fn().mockResolvedValue(undefined),
}))

const mockGetProxyObject = vi.fn().mockResolvedValue({
  getInterface: mockGetInterface,
})

vi.mock('dbus-next', () => {
  const MessageType = { SIGNAL: 4, METHOD_CALL: 1 }
  const Variant = vi.fn((type: string, value: unknown) => ({ type, value }))

  return {
    default: {
      sessionBus: () => ({
        name: ':1.42',
        call: mockBusCall,
        disconnect: mockBusDisconnect,
        on: mockBusOn,
        once: mockBusOnce,
        removeListener: mockBusRemoveListener,
        getProxyObject: mockGetProxyObject,
      }),
      Message: vi.fn((opts: object) => opts),
    },
    MessageType,
    Variant,
  }
})

// --- Tests ---

describe('waylandShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    // Set XDG_RUNTIME_DIR for FIFO path resolution
    process.env.XDG_RUNTIME_DIR = '/run/user/1000'
  })

  describe('Hyprland exec+FIFO path', () => {
    it('creates FIFO and binds with exec dispatcher on Hyprland', async () => {
      const { registerWaylandShortcuts } = await import('./waylandShortcuts')
      const onActivated = vi.fn()

      const ok = await registerWaylandShortcuts(
        [
          { id: 'quick-chat', accelerator: 'Alt+Space', description: 'Quick Chat' },
          { id: 'quick-voice', accelerator: 'Super+E', description: 'Quick Voice' },
        ],
        onActivated
      )

      expect(ok).toBe(true)

      // FIFO should be created via mkfifo
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'mkfifo',
        ['/run/user/1000/agent-desktop-shortcuts.pipe'],
        expect.any(Object)
      )

      // FIFO should be opened with O_RDWR only (no O_NONBLOCK — causes EAGAIN)
      expect(mockOpenSync).toHaveBeenCalledWith(
        '/run/user/1000/agent-desktop-shortcuts.pipe',
        2 // O_RDWR
      )

      // hyprctl calls: version check + (unbind + bind) per shortcut
      const hyprctlCalls = mockExecFile.mock.calls.filter(c => c[0] === '/usr/bin/hyprctl')
      expect(hyprctlCalls.length).toBeGreaterThanOrEqual(3) // version + at least 2 binds

      // Verify exec dispatcher is used (not global)
      const bindCalls = hyprctlCalls.filter(c =>
        c[1][0] === 'keyword' && c[1][1] === 'bind'
      )
      for (const call of bindCalls) {
        const bindArgs = call[1][2] as string
        expect(bindArgs).toContain(',exec,echo ')
        expect(bindArgs).toContain('agent-desktop-shortcuts.pipe')
      }
    })

    it('cleans up stale FIFO before creating new one', async () => {
      const { registerWaylandShortcuts } = await import('./waylandShortcuts')

      await registerWaylandShortcuts(
        [{ id: 'test', accelerator: 'Alt+T', description: 'Test' }],
        vi.fn()
      )

      // unlinkSync should be called to remove stale FIFO
      expect(mockUnlinkSync).toHaveBeenCalledWith('/run/user/1000/agent-desktop-shortcuts.pipe')
    })

    it('creates read stream on FIFO fd', async () => {
      const { registerWaylandShortcuts } = await import('./waylandShortcuts')

      await registerWaylandShortcuts(
        [{ id: 'test', accelerator: 'Alt+T', description: 'Test' }],
        vi.fn()
      )

      expect(mockCreateReadStream).toHaveBeenCalledWith('', {
        fd: 42,
        encoding: 'utf8',
        autoClose: false,
      })
    })
  })

  describe('FIFO debounce', () => {
    it('suppresses rapid double-fire on the same shortcut id', async () => {
      vi.useFakeTimers()
      const { registerWaylandShortcuts } = await import('./waylandShortcuts')
      const onActivated = vi.fn()

      await registerWaylandShortcuts(
        [{ id: 'quick-voice', accelerator: 'Alt+Shift+Space', description: 'Quick Voice' }],
        onActivated
      )

      // Get the data handler registered on the stream mock
      const streamMock = mockCreateReadStream.mock.results[0].value
      const dataCall = streamMock.on.mock.calls.find((c: any[]) => c[0] === 'data')
      expect(dataCall).toBeDefined()
      const dataHandler = dataCall![1]

      // Simulate two rapid FIFO activations (double-fire, <150ms apart)
      dataHandler('quick-voice\n')
      dataHandler('quick-voice\n')

      expect(onActivated).toHaveBeenCalledTimes(1)
      expect(onActivated).toHaveBeenCalledWith('quick-voice')

      // After debounce period expires, next activation should pass through
      vi.advanceTimersByTime(200)
      dataHandler('quick-voice\n')

      expect(onActivated).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('allows different shortcut ids to fire independently', async () => {
      vi.useFakeTimers()
      const { registerWaylandShortcuts } = await import('./waylandShortcuts')
      const onActivated = vi.fn()

      await registerWaylandShortcuts(
        [
          { id: 'quick-chat', accelerator: 'Alt+Space', description: 'Quick Chat' },
          { id: 'quick-voice', accelerator: 'Alt+Shift+Space', description: 'Quick Voice' },
        ],
        onActivated
      )

      const streamMock = mockCreateReadStream.mock.results[0].value
      const dataCall = streamMock.on.mock.calls.find((c: any[]) => c[0] === 'data')
      const dataHandler = dataCall![1]

      // Two different IDs in rapid succession — both should pass
      dataHandler('quick-chat\n')
      dataHandler('quick-voice\n')

      expect(onActivated).toHaveBeenCalledTimes(2)
      expect(onActivated).toHaveBeenCalledWith('quick-chat')
      expect(onActivated).toHaveBeenCalledWith('quick-voice')

      vi.useRealTimers()
    })
  })

  describe('rebindWaylandShortcuts', () => {
    it('returns false when no active session exists', async () => {
      const { rebindWaylandShortcuts } = await import('./waylandShortcuts')

      const ok = await rebindWaylandShortcuts([
        { id: 'quick-chat', accelerator: 'Alt+Space' },
      ])

      expect(ok).toBe(false)
    })

    it('rebinds with exec+FIFO args after Hyprland registration', async () => {
      const { registerWaylandShortcuts, rebindWaylandShortcuts } = await import('./waylandShortcuts')

      // First register (creates FIFO + binds)
      await registerWaylandShortcuts(
        [{ id: 'quick-chat', accelerator: 'Alt+Space', description: 'Quick Chat' }],
        vi.fn()
      )

      vi.clearAllMocks()

      // Rebind with new key
      const ok = await rebindWaylandShortcuts([
        { id: 'quick-chat', accelerator: 'Ctrl+Space' },
      ])

      expect(ok).toBe(true)

      // Should use exec dispatcher with FIFO path
      const bindCalls = mockExecFile.mock.calls.filter(c =>
        c[0] === '/usr/bin/hyprctl' && c[1][0] === 'keyword' && c[1][1] === 'bind'
      )
      expect(bindCalls.length).toBe(1)
      expect(bindCalls[0][1][2]).toContain('CTRL,space,exec,echo quick-chat')
    })

    it('is exported alongside registerWaylandShortcuts', async () => {
      const mod = await import('./waylandShortcuts')
      expect(typeof mod.rebindWaylandShortcuts).toBe('function')
      expect(typeof mod.registerWaylandShortcuts).toBe('function')
      expect(typeof mod.unregisterWaylandShortcuts).toBe('function')
    })
  })

  describe('unregisterWaylandShortcuts', () => {
    it('can be called safely when nothing is registered', async () => {
      const { unregisterWaylandShortcuts } = await import('./waylandShortcuts')
      // Should not throw
      await unregisterWaylandShortcuts()
    })

    it('destroys FIFO and unbinds shortcuts on cleanup', async () => {
      const { registerWaylandShortcuts, unregisterWaylandShortcuts } = await import('./waylandShortcuts')

      await registerWaylandShortcuts(
        [{ id: 'test', accelerator: 'Alt+T', description: 'Test' }],
        vi.fn()
      )

      vi.clearAllMocks()

      await unregisterWaylandShortcuts()

      // FIFO should be closed and unlinked
      expect(mockCloseSync).toHaveBeenCalledWith(42)
      expect(mockUnlinkSync).toHaveBeenCalledWith('/run/user/1000/agent-desktop-shortcuts.pipe')

      // hyprctl unbind should be called
      const unbindCalls = mockExecFile.mock.calls.filter(c =>
        c[0] === '/usr/bin/hyprctl' && c[1][0] === 'keyword' && c[1][1] === 'unbind'
      )
      expect(unbindCalls.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('toHyprlandBind (via integration)', () => {
    it('correctly maps modifier keys in hyprctl bind args', async () => {
      const { registerWaylandShortcuts } = await import('./waylandShortcuts')

      await registerWaylandShortcuts(
        [
          { id: 'test1', accelerator: 'Alt+Shift+Space', description: 'Test 1' },
          { id: 'test2', accelerator: 'Ctrl+A', description: 'Test 2' },
          { id: 'test3', accelerator: 'Super+Z', description: 'Test 3' },
        ],
        vi.fn()
      )

      const bindCalls = mockExecFile.mock.calls.filter(c =>
        c[0] === '/usr/bin/hyprctl' && c[1][0] === 'keyword' && c[1][1] === 'bind'
      )

      const bindArgs = bindCalls.map(c => c[1][2] as string)
      expect(bindArgs).toContainEqual(expect.stringContaining('ALT SHIFT,space,exec,echo test1'))
      expect(bindArgs).toContainEqual(expect.stringContaining('CTRL,a,exec,echo test2'))
      expect(bindArgs).toContainEqual(expect.stringContaining('SUPER,z,exec,echo test3'))
    })
  })
})
