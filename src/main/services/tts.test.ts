import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks (before imports) ──────────────────────────────────

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

vi.mock('./streaming', () => ({
  injectApiKeyEnv: vi.fn(() => null),
}))

vi.mock('../utils/env', () => ({
  findBinaryInPath: vi.fn(),
}))

vi.mock('../utils/db', () => ({
  getSetting: vi.fn(),
}))

vi.mock('../utils/volume', () => ({
  duckOtherStreams: vi.fn().mockResolvedValue(undefined),
  restoreOtherStreams: vi.fn().mockResolvedValue(undefined),
}))

// Mock child_process spawn with controllable process events
let spawnCallbacks: Array<{
  proc: Record<string, (...args: unknown[]) => void>
  stderr: Record<string, (d: Buffer) => void>
}> = []

function createMockProc() {
  const entry: (typeof spawnCallbacks)[0] = { proc: {}, stderr: {} }
  spawnCallbacks.push(entry)
  return {
    stdout: { on: vi.fn() },
    stderr: {
      on: vi.fn((event: string, cb: (d: Buffer) => void) => {
        entry.stderr[event] = cb
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      entry.proc[event] = cb
    }),
    kill: vi.fn(),
    pid: 12345,
  }
}

const mockSpawn = vi.fn(() => createMockProc())

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

vi.mock('fs', () => ({
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))

// ─── Imports (after mocks) ───────────────────────────────────

import { stop, speak, speakResponse, validateConfig, detectPlayers, registerHandlers } from './tts'
import { findBinaryInPath } from '../utils/env'
import { getSetting } from '../utils/db'
import { loadAgentSDK } from './anthropic'
import { injectApiKeyEnv } from './streaming'
import { duckOtherStreams, restoreOtherStreams } from '../utils/volume'
import { getMainWindow } from '../index'

const mockFindBinary = vi.mocked(findBinaryInPath)
const mockGetSetting = vi.mocked(getSetting)
const mockLoadSDK = vi.mocked(loadAgentSDK)
const mockInjectApiKey = vi.mocked(injectApiKeyEnv)
const mockDuck = vi.mocked(duckOtherStreams)
const mockRestore = vi.mocked(restoreOtherStreams)
const mockGetMainWindow = vi.mocked(getMainWindow)

const flush = () => new Promise((r) => setTimeout(r, 0))

/** Fake db object — all DB access is mocked via getSetting */
const db = {} as any

function settingsMap(map: Record<string, string>) {
  mockGetSetting.mockImplementation((_db: any, key: string) => map[key] || '')
}

function resolveSpawnExit(index: number, code: number) {
  const cb = spawnCallbacks[index]
  if (cb?.proc['exit']) cb.proc['exit'](code, null)
}

function rejectSpawnError(index: number) {
  const cb = spawnCallbacks[index]
  const err = new Error('spawn error') as NodeJS.ErrnoException
  err.code = 'ENOENT'
  if (cb?.proc['error']) cb.proc['error'](err)
}

// ─── Tests ───────────────────────────────────────────────────

describe('tts service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spawnCallbacks = []
    mockGetSetting.mockReturnValue('')
    mockFindBinary.mockReturnValue(null)
    mockGetMainWindow.mockReturnValue(null)
  })

  // ── stop ──────────────────────────────────────────────────

  describe('stop', () => {
    it('does nothing when no process is running', () => {
      expect(() => stop()).not.toThrow()
    })

    it('kills the current process after speak starts', async () => {
      settingsMap({ tts_provider: 'spd-say' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      // Start speak — spawns spd-say
      const promise = speak('hello', db)
      await flush()

      // Now stop while the process is alive
      stop()

      // The spawned mock proc should have kill called
      const proc = mockSpawn.mock.results[0]?.value
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM')

      // Resolve the spawn so the promise settles
      resolveSpawnExit(0, 0)
      // The promise may reject since we killed, but stop() shouldn't throw
      await promise.catch(() => {})
    })

    it('notifies speaking state as false', () => {
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      mockGetMainWindow.mockReturnValue(mockWin as any)

      stop()

      expect(mockWin.webContents.send).toHaveBeenCalledWith('tts:stateChange', { speaking: false })
    })
  })

  // ── speak ─────────────────────────────────────────────────

  describe('speak', () => {
    it('returns early when provider is off', async () => {
      settingsMap({ tts_provider: 'off' })
      await speak('hello', db)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('returns early when provider is empty', async () => {
      settingsMap({})
      await speak('hello', db)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('returns early when text is empty after stripping', async () => {
      settingsMap({ tts_provider: 'spd-say' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      // Only markdown formatting, no actual text
      await speak('```\n```', db)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('throws for unknown provider', async () => {
      settingsMap({ tts_provider: 'unknown_provider' })
      await expect(speak('hello', db)).rejects.toThrow('Unknown TTS provider: unknown_provider')
    })

    it('calls spd-say provider when configured', async () => {
      settingsMap({ tts_provider: 'spd-say' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      const promise = speak('hello', db)
      await flush()

      expect(mockSpawn).toHaveBeenCalledWith('spd-say', ['-e', 'hello'], expect.any(Object))

      resolveSpawnExit(0, 0)
      await promise
    })

    it('throws when spd-say binary not found', async () => {
      settingsMap({ tts_provider: 'spd-say' })
      mockFindBinary.mockReturnValue(null)

      await expect(speak('hello', db)).rejects.toThrow('spd-say binary not found')
    })

    it('throws when edgetts binary not found', async () => {
      settingsMap({ tts_provider: 'edgetts' })
      mockFindBinary.mockReturnValue(null)

      await expect(speak('hello', db)).rejects.toThrow('edge-tts binary not found')
    })

    it('throws when piper URL not configured', async () => {
      settingsMap({ tts_provider: 'piper' })

      await expect(speak('hello', db)).rejects.toThrow('Piper URL not configured')
    })

    it('strips markdown before speaking', async () => {
      settingsMap({ tts_provider: 'spd-say' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      const promise = speak('# Hello **world**', db)
      await flush()

      // Should strip heading marker and bold markers
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(spawnArgs[1]).toBe('Hello world')

      resolveSpawnExit(0, 0)
      await promise
    })

    it('truncates to maxLength setting', async () => {
      settingsMap({ tts_provider: 'spd-say', tts_maxLength: '5' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      const promise = speak('Hello world this is long text', db)
      await flush()

      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(spawnArgs[1]).toBe('Hello')

      resolveSpawnExit(0, 0)
      await promise
    })

    it('ducks audio when voice_volumeDuck > 0', async () => {
      settingsMap({ tts_provider: 'spd-say', voice_volumeDuck: '30' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      const promise = speak('hello', db)
      await flush()

      expect(mockDuck).toHaveBeenCalledWith(30)

      resolveSpawnExit(0, 0)
      await promise

      expect(mockRestore).toHaveBeenCalled()
    })

    it('does not duck audio when voice_volumeDuck is 0', async () => {
      settingsMap({ tts_provider: 'spd-say', voice_volumeDuck: '0' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      const promise = speak('hello', db)
      await flush()

      expect(mockDuck).not.toHaveBeenCalled()

      resolveSpawnExit(0, 0)
      await promise
    })

    it('restores audio even on error', async () => {
      settingsMap({ tts_provider: 'spd-say', voice_volumeDuck: '20' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      const promise = speak('hello', db)
      await flush()

      rejectSpawnError(0)
      await promise.catch(() => {})

      expect(mockRestore).toHaveBeenCalled()
    })

    it('notifies speaking state true then false', async () => {
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } }
      mockGetMainWindow.mockReturnValue(mockWin as any)
      settingsMap({ tts_provider: 'spd-say' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      const promise = speak('hello', db)
      await flush()

      // First call from stop() at start (false), second from notifySpeakingState(true)
      const calls = mockWin.webContents.send.mock.calls.filter(
        (c: unknown[]) => c[0] === 'tts:stateChange'
      )
      expect(calls.some((c: unknown[]) => (c[1] as any).speaking === true)).toBe(true)

      resolveSpawnExit(0, 0)
      await promise

      const allCalls = mockWin.webContents.send.mock.calls.filter(
        (c: unknown[]) => c[0] === 'tts:stateChange'
      )
      // Last call should be speaking: false
      expect(allCalls[allCalls.length - 1][1]).toEqual({ speaking: false })
    })

    it('calls edgetts provider with correct args', async () => {
      settingsMap({
        tts_provider: 'edgetts',
        tts_edgettsVoice: 'en-GB-RyanNeural',
        tts_edgettsBinary: 'edge-tts',
        tts_playerPath: 'mpv',
      })
      mockFindBinary.mockReturnValue('/usr/bin/edge-tts')

      const promise = speak('hello', db)
      await flush()

      // edge-tts spawn (synthesis)
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/edge-tts',
        expect.arrayContaining(['--text', 'hello', '--voice', 'en-GB-RyanNeural', '--write-media']),
        expect.any(Object),
      )

      // Complete edge-tts synthesis → triggers playAudioFile which spawns player
      resolveSpawnExit(0, 0)
      await flush()

      // Complete player process
      resolveSpawnExit(1, 0)
      await promise
    })
  })

  // ── validateConfig ────────────────────────────────────────

  describe('validateConfig', () => {
    it('returns success when provider is off', async () => {
      settingsMap({ tts_provider: 'off' })

      const result = await validateConfig(db)

      expect(result).toEqual({
        provider: 'off',
        providerFound: true,
        playerFound: true,
        playerPath: '',
      })
      expect(result.error).toBeUndefined()
    })

    it('returns success when provider is empty (defaults to off)', async () => {
      settingsMap({})

      const result = await validateConfig(db)

      expect(result).toEqual({
        provider: 'off',
        providerFound: true,
        playerFound: true,
        playerPath: '',
      })
    })

    it('piper: success with url and player', async () => {
      settingsMap({ tts_provider: 'piper', tts_piperUrl: 'http://localhost:5000', tts_playerPath: 'mpv' })
      mockFindBinary.mockImplementation((name: string) => {
        if (name === 'mpv') return '/usr/bin/mpv'
        return null
      })

      const result = await validateConfig(db)

      expect(result.provider).toBe('piper')
      expect(result.providerFound).toBe(true)
      expect(result.playerFound).toBe(true)
      expect(result.playerPath).toBe('/usr/bin/mpv')
      expect(result.error).toBeUndefined()
    })

    it('piper: error when url not configured', async () => {
      settingsMap({ tts_provider: 'piper', tts_playerPath: 'mpv' })
      mockFindBinary.mockImplementation((name: string) => {
        if (name === 'mpv') return '/usr/bin/mpv'
        return null
      })

      const result = await validateConfig(db)

      expect(result.providerFound).toBe(false)
      expect(result.error).toContain('Piper URL not configured')
    })

    it('piper: error when no player found', async () => {
      // Use nonexistent configured player to bypass autoDetect cache
      settingsMap({ tts_provider: 'piper', tts_piperUrl: 'http://localhost:5000', tts_playerPath: 'nonexistent-player' })
      mockFindBinary.mockReturnValue(null)

      const result = await validateConfig(db)

      expect(result.playerFound).toBe(false)
      expect(result.error).toContain('No audio player found')
    })

    it('piper: both errors when url missing and no player', async () => {
      settingsMap({ tts_provider: 'piper', tts_playerPath: 'nonexistent-player' })
      mockFindBinary.mockReturnValue(null)

      const result = await validateConfig(db)

      expect(result.providerFound).toBe(false)
      expect(result.playerFound).toBe(false)
      expect(result.error).toContain('Piper URL not configured')
      expect(result.error).toContain('No audio player found')
    })

    it('edgetts: success with binary and player found', async () => {
      settingsMap({ tts_provider: 'edgetts', tts_edgettsBinary: 'edge-tts', tts_playerPath: 'mpv' })
      mockFindBinary.mockImplementation((name: string) => {
        if (name === 'edge-tts') return '/usr/bin/edge-tts'
        if (name === 'mpv') return '/usr/bin/mpv'
        return null
      })

      const result = await validateConfig(db)

      expect(result.providerFound).toBe(true)
      expect(result.playerFound).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('edgetts: error when binary not found', async () => {
      settingsMap({ tts_provider: 'edgetts', tts_edgettsBinary: 'edge-tts', tts_playerPath: 'nonexistent' })
      mockFindBinary.mockReturnValue(null)

      const result = await validateConfig(db)

      expect(result.providerFound).toBe(false)
      expect(result.error).toContain('edge-tts binary not found')
    })

    it('edgetts: defaults binary name to edge-tts when not set', async () => {
      settingsMap({ tts_provider: 'edgetts', tts_playerPath: 'nonexistent' })
      mockFindBinary.mockReturnValue(null)

      const result = await validateConfig(db)

      expect(result.error).toContain('edge-tts binary not found: edge-tts')
    })

    it('spd-say: success when binary found', async () => {
      settingsMap({ tts_provider: 'spd-say' })
      mockFindBinary.mockReturnValue('/usr/bin/spd-say')

      const result = await validateConfig(db)

      expect(result.providerFound).toBe(true)
      expect(result.playerFound).toBe(true) // spd-say plays directly
      expect(result.error).toBeUndefined()
    })

    it('spd-say: error when binary not found', async () => {
      settingsMap({ tts_provider: 'spd-say' })
      mockFindBinary.mockReturnValue(null)

      const result = await validateConfig(db)

      expect(result.providerFound).toBe(false)
      expect(result.playerFound).toBe(true) // still true — spd-say plays directly
      expect(result.error).toContain('spd-say binary not found')
    })

    it('unknown provider returns error', async () => {
      settingsMap({ tts_provider: 'festival' })

      const result = await validateConfig(db)

      expect(result.error).toContain('Unknown provider: festival')
      expect(result.providerFound).toBe(false)
      expect(result.playerFound).toBe(false)
    })
  })

  // ── detectPlayers ─────────────────────────────────────────

  describe('detectPlayers', () => {
    it('returns all four players with availability', () => {
      mockFindBinary.mockImplementation((name: string) => {
        if (name === 'mpv') return '/usr/bin/mpv'
        if (name === 'aplay') return '/usr/bin/aplay'
        return null
      })

      const players = detectPlayers()

      expect(players).toEqual([
        { name: 'mpv', path: '/usr/bin/mpv', available: true },
        { name: 'ffplay', path: '', available: false },
        { name: 'paplay', path: '', available: false },
        { name: 'aplay', path: '/usr/bin/aplay', available: true },
      ])
    })

    it('returns all unavailable when none found', () => {
      mockFindBinary.mockReturnValue(null)

      const players = detectPlayers()

      expect(players).toHaveLength(4)
      expect(players.every((p) => !p.available)).toBe(true)
      expect(players.every((p) => p.path === '')).toBe(true)
    })

    it('returns all available when all found', () => {
      mockFindBinary.mockImplementation((name: string) => `/usr/bin/${name}`)

      const players = detectPlayers()

      expect(players).toHaveLength(4)
      expect(players.every((p) => p.available)).toBe(true)
    })
  })

  // ── speakResponse ─────────────────────────────────────────

  describe('speakResponse', () => {
    it('returns early when mode is off', async () => {
      await speakResponse('hello world', db, 1, { ttsResponseMode: 'off' })
      expect(mockGetSetting).not.toHaveBeenCalled()
    })

    it('returns early when mode is undefined', async () => {
      await speakResponse('hello world', db, 1, {})
      expect(mockGetSetting).not.toHaveBeenCalled()
    })

    it('mode full: calls speak with content', async () => {
      // Make speak() return early by setting provider to off
      settingsMap({ tts_provider: 'off' })

      await speakResponse('the full response text', db, 1, { ttsResponseMode: 'full' })

      // speak was called — it reads tts_provider from db
      expect(mockGetSetting).toHaveBeenCalledWith(db, 'tts_provider')
    })

    it('mode summary: generates summary then speaks', async () => {
      settingsMap({ tts_provider: 'off' })

      // Mock SDK for summary generation
      const mockQuery = vi.fn()
      const summaryMessages = (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'This is a summary.',
        }
      })()
      mockQuery.mockReturnValue(summaryMessages)
      mockLoadSDK.mockResolvedValue({ query: mockQuery } as any)
      mockInjectApiKey.mockReturnValue(vi.fn())

      await speakResponse('a very long response that needs summarizing', db, 1, {
        ttsResponseMode: 'summary',
      })

      // Should have loaded SDK for summary
      expect(mockLoadSDK).toHaveBeenCalled()
      // speak was called
      expect(mockGetSetting).toHaveBeenCalledWith(db, 'tts_provider')
    })

    it('mode auto: speaks full when word count under limit', async () => {
      settingsMap({ tts_provider: 'off' })

      // "hello world" = 2 words, default limit = 200
      await speakResponse('hello world', db, 1, { ttsResponseMode: 'auto' })

      // Should NOT generate summary (no SDK call)
      expect(mockLoadSDK).not.toHaveBeenCalled()
      // speak was called
      expect(mockGetSetting).toHaveBeenCalledWith(db, 'tts_provider')
    })

    it('mode auto: summarizes when word count over limit', async () => {
      settingsMap({ tts_provider: 'off' })

      // Generate text with > 200 words
      const longText = Array(250).fill('word').join(' ')

      const mockQuery = vi.fn()
      const summaryMessages = (async function* () {
        yield { type: 'result', subtype: 'success', result: 'Summary of long text.' }
      })()
      mockQuery.mockReturnValue(summaryMessages)
      mockLoadSDK.mockResolvedValue({ query: mockQuery } as any)
      mockInjectApiKey.mockReturnValue(vi.fn())

      await speakResponse(longText, db, 1, { ttsResponseMode: 'auto' })

      expect(mockLoadSDK).toHaveBeenCalled()
    })

    it('mode auto: respects custom ttsAutoWordLimit', async () => {
      settingsMap({ tts_provider: 'off' })

      // 10 words, limit 5 — should summarize
      const text = 'one two three four five six seven eight nine ten'

      const mockQuery = vi.fn()
      const summaryMessages = (async function* () {
        yield { type: 'result', subtype: 'success', result: 'Summary' }
      })()
      mockQuery.mockReturnValue(summaryMessages)
      mockLoadSDK.mockResolvedValue({ query: mockQuery } as any)
      mockInjectApiKey.mockReturnValue(vi.fn())

      await speakResponse(text, db, 1, {
        ttsResponseMode: 'auto',
        ttsAutoWordLimit: 5,
      })

      expect(mockLoadSDK).toHaveBeenCalled()
    })

    it('catches errors without throwing', async () => {
      settingsMap({ tts_provider: 'unknown_bad_provider' })

      // Should not throw even though speak will throw
      await expect(
        speakResponse('hello', db, 1, { ttsResponseMode: 'full' })
      ).resolves.toBeUndefined()
    })

    it('summary: falls back to truncated content when SDK fails', async () => {
      settingsMap({ tts_provider: 'off' })

      mockLoadSDK.mockRejectedValue(new Error('SDK failed'))
      mockInjectApiKey.mockReturnValue(vi.fn())

      // Should not throw — catches error internally and uses truncated original
      await speakResponse('some content', db, 1, { ttsResponseMode: 'summary' })

      expect(mockGetSetting).toHaveBeenCalledWith(db, 'tts_provider')
    })

    it('summary: uses custom ttsSummaryPrompt', async () => {
      settingsMap({ tts_provider: 'off' })

      const mockQuery = vi.fn()
      const summaryMessages = (async function* () {
        yield { type: 'result', subtype: 'success', result: 'Custom summary' }
      })()
      mockQuery.mockReturnValue(summaryMessages)
      mockLoadSDK.mockResolvedValue({ query: mockQuery } as any)
      mockInjectApiKey.mockReturnValue(vi.fn())

      await speakResponse('content here', db, 1, {
        ttsResponseMode: 'summary',
        ttsSummaryPrompt: 'My custom prompt: {response}',
      })

      // Verify the SDK was called with the custom prompt
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('My custom prompt:'),
        })
      )
    })

    it('summary: restores env after generating summary', async () => {
      settingsMap({ tts_provider: 'off' })

      const restoreFn = vi.fn()
      mockInjectApiKey.mockReturnValue(restoreFn)

      const mockQuery = vi.fn()
      const summaryMessages = (async function* () {
        yield { type: 'result', subtype: 'success', result: 'Summary' }
      })()
      mockQuery.mockReturnValue(summaryMessages)
      mockLoadSDK.mockResolvedValue({ query: mockQuery } as any)

      await speakResponse('content', db, 1, { ttsResponseMode: 'summary' })

      expect(restoreFn).toHaveBeenCalled()
    })
  })

  // ── registerHandlers ──────────────────────────────────────

  describe('registerHandlers', () => {
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
      }
    }

    it('registers all four IPC handlers', () => {
      const ipc = createMockIpcMain()
      registerHandlers(ipc as any, db)

      expect(ipc.invoke('tts:speak', 'hello')).toBeDefined()
      expect(ipc.invoke('tts:stop')).toBeDefined()
      expect(ipc.invoke('tts:validate')).toBeDefined()
      expect(ipc.invoke('tts:detectPlayers')).toBeDefined()
    })

    it('tts:speak validates input', async () => {
      const ipc = createMockIpcMain()
      registerHandlers(ipc as any, db)

      await expect(ipc.invoke('tts:speak', 42)).rejects.toThrow('text must be a string')
    })

    it('tts:stop calls stop()', async () => {
      const ipc = createMockIpcMain()
      registerHandlers(ipc as any, db)

      // Should not throw
      await ipc.invoke('tts:stop')
    })

    it('tts:validate returns config', async () => {
      settingsMap({ tts_provider: 'off' })
      const ipc = createMockIpcMain()
      registerHandlers(ipc as any, db)

      const result = await ipc.invoke('tts:validate')
      expect(result.provider).toBe('off')
      expect(result.providerFound).toBe(true)
    })

    it('tts:detectPlayers returns player list', async () => {
      mockFindBinary.mockReturnValue(null)
      const ipc = createMockIpcMain()
      registerHandlers(ipc as any, db)

      const result = await ipc.invoke('tts:detectPlayers')
      expect(result).toHaveLength(4)
    })
  })
})
