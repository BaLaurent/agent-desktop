import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// ─── Mocks (before imports) ──────────────────────────────────

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/mock/app' },
}))

vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('../utils/env', () => ({
  findBinaryInPath: vi.fn(),
}))

// Mock readline.createInterface — capture line callbacks
let readlineInstances: Array<{ lineCallbacks: Array<(line: string) => void> }> = []

vi.mock('readline', () => ({
  createInterface: vi.fn(() => {
    const instance = { lineCallbacks: [] as Array<(line: string) => void> }
    readlineInstances.push(instance)
    return {
      on: vi.fn((event: string, cb: (line: string) => void) => {
        if (event === 'line') instance.lineCallbacks.push(cb)
      }),
    }
  }),
}))

// Mock child_process spawn with controllable process events
function createMockProc() {
  const proc = new EventEmitter() as any
  proc.stdin = { writable: true, write: vi.fn() }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.killed = false
  proc.kill = vi.fn(() => { proc.killed = true })
  proc.pid = 99999
  return proc
}

const mockSpawn = vi.fn(() => createMockProc())

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

// ─── Imports (after mocks) ───────────────────────────────────

import { registerHandlers, shutdownAllKernels } from './jupyter'
import { findBinaryInPath } from '../utils/env'
import { getMainWindow } from '../index'

const mockFindBinary = vi.mocked(findBinaryInPath)
const mockGetMainWindow = vi.mocked(getMainWindow)

// ─── Helpers ─────────────────────────────────────────────────

function createMockIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>()
  return {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    },
    invoke: async (channel: string, ...args: any[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler({} as any, ...args)
    },
    handlers,
  }
}

/** Emit a line on the nth readline instance (0-indexed) */
function emitLine(rlIndex: number, line: string) {
  const instance = readlineInstances[rlIndex]
  if (!instance) throw new Error(`No readline instance at index ${rlIndex}`)
  for (const cb of instance.lineCallbacks) {
    cb(line)
  }
}

// ─── Tests ───────────────────────────────────────────────────

describe('jupyter service', () => {
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(() => {
    vi.clearAllMocks()
    readlineInstances = []
    mockFindBinary.mockReturnValue(null)
    mockGetMainWindow.mockReturnValue(null)
    mockSpawn.mockImplementation(() => createMockProc())

    // Re-register handlers each test for a fresh ipc; module-level kernels Map
    // persists across tests, so we shut down all kernels before each test.
    shutdownAllKernels()
    vi.clearAllMocks()
    readlineInstances = []

    ipc = createMockIpcMain()
    registerHandlers(ipc as any)
  })

  // ── registerHandlers ──────────────────────────────────────

  describe('registerHandlers', () => {
    it('registers all expected IPC channels', () => {
      const expectedChannels = [
        'jupyter:startKernel',
        'jupyter:executeCell',
        'jupyter:interruptKernel',
        'jupyter:restartKernel',
        'jupyter:shutdownKernel',
        'jupyter:getStatus',
        'jupyter:detectJupyter',
      ]

      for (const channel of expectedChannels) {
        expect(ipc.handlers.has(channel)).toBe(true)
      }
    })

    it('registers exactly 7 channels', () => {
      expect(ipc.handlers.size).toBe(7)
    })
  })

  // ── startKernel ───────────────────────────────────────────

  describe('jupyter:startKernel', () => {
    it('throws when python is not found', async () => {
      mockFindBinary.mockReturnValue(null)

      await expect(ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb'))
        .rejects.toThrow('Python not found in PATH')
    })

    it('spawns python with bridge script when python3 found', async () => {
      mockFindBinary.mockImplementation((name: string) =>
        name === 'python3' ? '/usr/bin/python3' : null
      )

      const result = await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      expect(result).toEqual({ status: 'starting' })
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/python3',
        ['/mock/app/resources/jupyter/bridge.py'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      )
    })

    it('falls back to python when python3 not found', async () => {
      mockFindBinary.mockImplementation((name: string) =>
        name === 'python' ? '/usr/bin/python' : null
      )

      const result = await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      expect(result).toEqual({ status: 'starting' })
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/python',
        expect.any(Array),
        expect.any(Object),
      )
    })

    it('sets JUPYTER_KERNEL_NAME env when kernelName provided', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb', 'julia-1.9')

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv.JUPYTER_KERNEL_NAME).toBe('julia-1.9')
    })

    it('does not set JUPYTER_KERNEL_NAME when kernelName omitted', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const spawnEnv = mockSpawn.mock.calls[0][2].env
      expect(spawnEnv.JUPYTER_KERNEL_NAME).toBeUndefined()
    })

    it('returns existing kernel status if already running', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      // Second call for same filePath should not spawn again
      const result = await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      expect(result).toEqual({ status: 'starting' })
      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })

    it('validates filePath is a string', async () => {
      await expect(ipc.invoke('jupyter:startKernel', 42))
        .rejects.toThrow('filePath must be a string')
    })

    it('validates kernelName is a string when provided', async () => {
      await expect(ipc.invoke('jupyter:startKernel', '/test/nb.ipynb', 123))
        .rejects.toThrow('kernelName must be a string')
    })

    it('sends ready event to renderer when kernel reports ready', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      mockGetMainWindow.mockReturnValue(mockWin as any)

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      // readline instance 0 is stdout
      emitLine(0, JSON.stringify({ type: 'ready', language: 'python' }))

      expect(mockWin.webContents.send).toHaveBeenCalledWith('jupyter:output', {
        filePath: '/test/notebook.ipynb',
        id: null,
        type: 'ready',
        language: 'python',
        state: 'idle',
      })
    })

    it('updates kernel status to idle on ready message', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      emitLine(0, JSON.stringify({ type: 'ready', language: 'python' }))

      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBe('idle')
    })

    it('tracks busy status from status messages', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      emitLine(0, JSON.stringify({ type: 'status', state: 'busy' }))

      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBe('busy')
    })

    it('forwards non-ready messages to renderer with filePath', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      mockGetMainWindow.mockReturnValue(mockWin as any)

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const execResult = { type: 'execute_result', id: 'req_1', data: { 'text/plain': '42' } }
      emitLine(0, JSON.stringify(execResult))

      expect(mockWin.webContents.send).toHaveBeenCalledWith('jupyter:output', {
        ...execResult,
        filePath: '/test/notebook.ipynb',
      })
    })

    it('ignores non-JSON lines on stdout', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      mockGetMainWindow.mockReturnValue(mockWin as any)

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      // Should not throw
      emitLine(0, 'not valid json {')

      expect(mockWin.webContents.send).not.toHaveBeenCalled()
    })

    it('removes kernel and sends dead status on process exit', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      mockGetMainWindow.mockReturnValue(mockWin as any)

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      // Trigger exit event on the spawned proc
      const proc = mockSpawn.mock.results[0].value
      proc.emit('exit', 0)

      expect(mockWin.webContents.send).toHaveBeenCalledWith('jupyter:output', {
        filePath: '/test/notebook.ipynb',
        id: null,
        type: 'status',
        state: 'dead',
      })

      // Kernel should be removed
      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBeNull()
    })

    it('removes kernel and sends error on spawn error', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      mockGetMainWindow.mockReturnValue(mockWin as any)

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      proc.emit('error', new Error('spawn failed'))

      expect(mockWin.webContents.send).toHaveBeenCalledWith('jupyter:output', expect.objectContaining({
        filePath: '/test/notebook.ipynb',
        id: null,
        type: 'error',
        ename: 'SpawnError',
        traceback: [],
      }))

      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBeNull()
    })

    it('does not send to renderer when window is destroyed', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      const mockWin = { isDestroyed: () => true, webContents: { send: vi.fn() } }
      mockGetMainWindow.mockReturnValue(mockWin as any)

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      emitLine(0, JSON.stringify({ type: 'ready', language: 'python' }))

      expect(mockWin.webContents.send).not.toHaveBeenCalled()
    })

    it('does not send to renderer when window is null', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      mockGetMainWindow.mockReturnValue(null)

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      // Should not throw
      emitLine(0, JSON.stringify({ type: 'ready', language: 'python' }))
    })

    it('defaults language to python when ready message has no language', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      mockGetMainWindow.mockReturnValue(mockWin as any)

      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      emitLine(0, JSON.stringify({ type: 'ready' }))

      expect(mockWin.webContents.send).toHaveBeenCalledWith('jupyter:output', expect.objectContaining({
        language: 'python',
      }))
    })
  })

  // ── executeCell ───────────────────────────────────────────

  describe('jupyter:executeCell', () => {
    it('writes JSON line to stdin and returns request ID', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      const id = await ipc.invoke('jupyter:executeCell', '/test/notebook.ipynb', 'print("hi")')

      expect(id).toBe('req_1')
      expect(proc.stdin.write).toHaveBeenCalledWith(
        JSON.stringify({ id: 'req_1', action: 'execute', code: 'print("hi")' }) + '\n'
      )
    })

    it('increments request IDs', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const id1 = await ipc.invoke('jupyter:executeCell', '/test/notebook.ipynb', 'code1')
      const id2 = await ipc.invoke('jupyter:executeCell', '/test/notebook.ipynb', 'code2')

      expect(id1).toBe('req_1')
      expect(id2).toBe('req_2')
    })

    it('throws when no kernel is running', async () => {
      await expect(ipc.invoke('jupyter:executeCell', '/nonexistent.ipynb', 'code'))
        .rejects.toThrow('No kernel running for this notebook')
    })

    it('throws when stdin is not writable', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      proc.stdin.writable = false

      await expect(ipc.invoke('jupyter:executeCell', '/test/notebook.ipynb', 'code'))
        .rejects.toThrow('Kernel stdin not writable')
    })

    it('validates filePath is a string', async () => {
      await expect(ipc.invoke('jupyter:executeCell', 42, 'code'))
        .rejects.toThrow('filePath must be a string')
    })

    it('validates code is a string', async () => {
      await expect(ipc.invoke('jupyter:executeCell', '/test/nb.ipynb', 42))
        .rejects.toThrow('code must be a string')
    })
  })

  // ── interruptKernel ───────────────────────────────────────

  describe('jupyter:interruptKernel', () => {
    it('writes interrupt action to stdin', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      await ipc.invoke('jupyter:interruptKernel', '/test/notebook.ipynb')

      expect(proc.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"action":"interrupt"')
      )
    })

    it('throws when no kernel is running', async () => {
      await expect(ipc.invoke('jupyter:interruptKernel', '/nonexistent.ipynb'))
        .rejects.toThrow('No kernel running for this notebook')
    })

    it('does nothing when stdin is not writable', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      proc.stdin.writable = false

      // Should not throw
      await ipc.invoke('jupyter:interruptKernel', '/test/notebook.ipynb')
      expect(proc.stdin.write).not.toHaveBeenCalled()
    })

    it('validates filePath is a string', async () => {
      await expect(ipc.invoke('jupyter:interruptKernel', null))
        .rejects.toThrow('filePath must be a string')
    })
  })

  // ── restartKernel ─────────────────────────────────────────

  describe('jupyter:restartKernel', () => {
    it('writes restart action to stdin and resets status to starting', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      // Move to idle first
      emitLine(0, JSON.stringify({ type: 'ready', language: 'python' }))
      expect(await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')).toBe('idle')

      const proc = mockSpawn.mock.results[0].value
      await ipc.invoke('jupyter:restartKernel', '/test/notebook.ipynb')

      expect(proc.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"action":"restart"')
      )

      // Status should reset to starting
      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBe('starting')
    })

    it('throws when no kernel is running', async () => {
      await expect(ipc.invoke('jupyter:restartKernel', '/nonexistent.ipynb'))
        .rejects.toThrow('No kernel running for this notebook')
    })

    it('does nothing when stdin is not writable', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      proc.stdin.writable = false

      await ipc.invoke('jupyter:restartKernel', '/test/notebook.ipynb')
      expect(proc.stdin.write).not.toHaveBeenCalled()
    })

    it('validates filePath is a string', async () => {
      await expect(ipc.invoke('jupyter:restartKernel', undefined))
        .rejects.toThrow('filePath must be a string')
    })
  })

  // ── shutdownKernel ────────────────────────────────────────

  describe('jupyter:shutdownKernel', () => {
    it('writes shutdown action to stdin', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      await ipc.invoke('jupyter:shutdownKernel', '/test/notebook.ipynb')

      expect(proc.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"action":"shutdown"')
      )
    })

    it('removes kernel from map immediately', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      await ipc.invoke('jupyter:shutdownKernel', '/test/notebook.ipynb')

      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBeNull()
    })

    it('does nothing when no kernel exists', async () => {
      // Should not throw
      await ipc.invoke('jupyter:shutdownKernel', '/nonexistent.ipynb')
    })

    it('force kills after 3s timeout when process does not exit', async () => {
      vi.useFakeTimers()
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      await ipc.invoke('jupyter:shutdownKernel', '/test/notebook.ipynb')

      expect(proc.kill).not.toHaveBeenCalled()

      vi.advanceTimersByTime(3000)

      expect(proc.kill).toHaveBeenCalledWith('SIGKILL')

      vi.useRealTimers()
    })

    it('clears timeout when process exits before 3s', async () => {
      vi.useFakeTimers()
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      await ipc.invoke('jupyter:shutdownKernel', '/test/notebook.ipynb')

      // Process exits before timeout
      proc.emit('exit', 0)

      vi.advanceTimersByTime(3000)

      // kill should not have been called since exit fired first
      expect(proc.kill).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('does not write to stdin when it is not writable', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const proc = mockSpawn.mock.results[0].value
      proc.stdin.writable = false

      await ipc.invoke('jupyter:shutdownKernel', '/test/notebook.ipynb')

      expect(proc.stdin.write).not.toHaveBeenCalled()
    })

    it('validates filePath is a string', async () => {
      await expect(ipc.invoke('jupyter:shutdownKernel', {}))
        .rejects.toThrow('filePath must be a string')
    })
  })

  // ── getStatus ─────────────────────────────────────────────

  describe('jupyter:getStatus', () => {
    it('returns null when no kernel exists', async () => {
      const status = await ipc.invoke('jupyter:getStatus', '/nonexistent.ipynb')
      expect(status).toBeNull()
    })

    it('returns starting for a newly created kernel', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBe('starting')
    })

    it('returns idle after ready message', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      emitLine(0, JSON.stringify({ type: 'ready', language: 'python' }))

      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBe('idle')
    })

    it('returns busy after busy status message', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      emitLine(0, JSON.stringify({ type: 'status', state: 'busy' }))

      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBe('busy')
    })

    it('ignores non-idle/busy status states', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')
      await ipc.invoke('jupyter:startKernel', '/test/notebook.ipynb')

      emitLine(0, JSON.stringify({ type: 'status', state: 'unknown_state' }))

      // Should remain 'starting' (not updated)
      const status = await ipc.invoke('jupyter:getStatus', '/test/notebook.ipynb')
      expect(status).toBe('starting')
    })

    it('validates filePath is a string', async () => {
      await expect(ipc.invoke('jupyter:getStatus', 42))
        .rejects.toThrow('filePath must be a string')
    })
  })

  // ── detectJupyter ─────────────────────────────────────────

  describe('jupyter:detectJupyter', () => {
    it('returns found: false with error when python is not in PATH', async () => {
      mockFindBinary.mockReturnValue(null)

      const result = await ipc.invoke('jupyter:detectJupyter')

      expect(result).toEqual({ found: false, pythonPath: null, error: 'Python not found in PATH' })
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('returns found: true when jupyter_client and ipykernel import succeeds', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      const promise = ipc.invoke('jupyter:detectJupyter')

      const proc = mockSpawn.mock.results[0].value
      proc.stdout.emit('data', Buffer.from('ok\n'))
      proc.emit('close', 0)

      const result = await promise

      expect(result).toEqual({ found: true, pythonPath: '/usr/bin/python3' })
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/python3',
        ['-c', 'import jupyter_client; import ipykernel; print("ok")'],
        expect.objectContaining({ timeout: 5000 }),
      )
    })

    it('returns found: false with error when python exits with non-zero code', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      const promise = ipc.invoke('jupyter:detectJupyter')

      const proc = mockSpawn.mock.results[0].value
      proc.stderr.emit('data', Buffer.from('ModuleNotFoundError: No module named \'ipykernel\''))
      proc.emit('close', 1)

      const result = await promise

      expect(result).toEqual({
        found: false,
        pythonPath: '/usr/bin/python3',
        error: 'ipykernel not installed. Run: pip install ipykernel',
      })
    })

    it('returns found: false with error on spawn error', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      const promise = ipc.invoke('jupyter:detectJupyter')

      const proc = mockSpawn.mock.results[0].value
      proc.emit('error', new Error('spawn failed'))

      const result = await promise

      expect(result).toEqual({
        found: false,
        pythonPath: '/usr/bin/python3',
        error: 'Failed to run Python',
      })
    })

    it('returns found: false when stdout does not contain ok', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      const promise = ipc.invoke('jupyter:detectJupyter')

      const proc = mockSpawn.mock.results[0].value
      proc.stdout.emit('data', Buffer.from('ModuleNotFoundError'))
      proc.emit('close', 0)

      const result = await promise

      expect(result).toMatchObject({ found: false, pythonPath: '/usr/bin/python3' })
      expect(result.error).toBeDefined()
    })
  })

  // ── shutdownAllKernels ────────────────────────────────────

  describe('shutdownAllKernels', () => {
    it('shuts down all running kernels', async () => {
      mockFindBinary.mockReturnValue('/usr/bin/python3')

      await ipc.invoke('jupyter:startKernel', '/test/a.ipynb')
      await ipc.invoke('jupyter:startKernel', '/test/b.ipynb')

      const procA = mockSpawn.mock.results[0].value
      const procB = mockSpawn.mock.results[1].value

      shutdownAllKernels()

      // Both should have shutdown written
      expect(procA.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"action":"shutdown"')
      )
      expect(procB.stdin.write).toHaveBeenCalledWith(
        expect.stringContaining('"action":"shutdown"')
      )

      // Both should be removed
      expect(await ipc.invoke('jupyter:getStatus', '/test/a.ipynb')).toBeNull()
      expect(await ipc.invoke('jupyter:getStatus', '/test/b.ipynb')).toBeNull()
    })

    it('does nothing when no kernels are running', () => {
      // Should not throw
      expect(() => shutdownAllKernels()).not.toThrow()
    })
  })
})
