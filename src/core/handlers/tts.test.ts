import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Mocked before the module under test is imported: `speakResponse` reaches the
// audio pipeline through `spawn`, and the binary lookup decides which provider
// branch is reachable on the test machine.
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ stdout: '' })),
}))
vi.mock('../utils/env', () => ({ findBinaryInPath: vi.fn((name: string) => `/usr/bin/${name}`) }))
vi.mock('../utils/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('../utils/volume', () => ({
  duckOtherStreams: vi.fn().mockResolvedValue(undefined),
  restoreOtherStreams: vi.fn().mockResolvedValue(undefined),
}))

// `vi.mock` factories are hoisted above the file body, so the spy they close
// over has to be hoisted with them.
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  errToCtx: (e: unknown) => ({ err: String(e) }),
}))

import { spawn } from 'child_process'
import { speakResponse } from './tts'

// A db whose only job is to answer `getSetting`, which is
// `db.prepare('SELECT value FROM settings WHERE key = ?').get(key)`.
function fakeDb(settings: Record<string, string>) {
  return {
    prepare: () => ({
      get: (key: string) =>
        key in settings ? { value: settings[key] } : undefined,
      all: () => [],
      run: () => {},
    }),
    exec: () => {},
  }
}

// A spawn that "plays" instantly. The exit is emitted on a microtask, not a
// timer: `runTrackedProcess` subscribes to 'exit' synchronously right after
// spawn() returns, so the next microtask is both the earliest safe moment and
// deterministic — no wall-clock wait, nothing to flake under load.
function spawnedProcess() {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void }
  proc.stderr = new EventEmitter()
  proc.kill = () => {}
  queueMicrotask(() => proc.emit('exit', 0))
  return proc
}

describe('speakResponse — response-mode dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    warn.mockClear()
    vi.mocked(spawn).mockImplementation(() => spawnedProcess() as never)
  })

  afterEach(() => { vi.clearAllMocks() })

  const db = () => fakeDb({ tts_provider: 'spd-say', tts_maxLength: '2000' })

  it('speaks the response in "full" mode', async () => {
    await speakResponse('Bonjour tout le monde', db(), 1, { ttsResponseMode: 'full' })
    expect(spawn).toHaveBeenCalled()
  })

  it('stays silent when the mode is "off"', async () => {
    await speakResponse('Bonjour tout le monde', db(), 1, { ttsResponseMode: 'off' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('stays silent when no mode is set', async () => {
    await speakResponse('Bonjour tout le monde', db(), 1, {})
    expect(spawn).not.toHaveBeenCalled()
  })

  // The regression this file exists for.
  //
  // The QML plugin shipped its own option list ("first" / "all"), values this
  // dispatcher has no branch for. They fell off the end of the if-chain, so
  // every Speak click and every turn-end auto-speak completed successfully and
  // played NOTHING — no audio, no error, no log line, and a settings dropdown
  // that looked applied. An unrecognised mode must speak and say why.
  it.each(['all', 'first', 'somethingNew'])(
    'speaks and warns on the unrecognised mode %s instead of silently doing nothing',
    async (mode) => {
      await speakResponse('Bonjour tout le monde', db(), 1, { ttsResponseMode: mode })
      expect(spawn).toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        'Unknown tts_responseMode, speaking full response',
        { mode },
      )
    },
  )
})
