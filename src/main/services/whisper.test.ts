import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import type Database from 'better-sqlite3'

// Mock child_process.spawn — returns a new mock proc each time
let spawnCallbacks: Array<{
  stdout: Record<string, (d: Buffer) => void>
  stderr: Record<string, (d: Buffer) => void>
  proc: Record<string, (...args: unknown[]) => void>
}> = []

function createMockProc() {
  const entry: (typeof spawnCallbacks)[0] = { stdout: {}, stderr: {}, proc: {} }
  spawnCallbacks.push(entry)
  return {
    stdout: {
      on: vi.fn((event: string, cb: (d: Buffer) => void) => {
        entry.stdout[event] = cb
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (d: Buffer) => void) => {
        entry.stderr[event] = cb
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      entry.proc[event] = cb
    }),
  }
}

const mockSpawn = vi.fn(() => createMockProc())

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

// Mock fs.promises
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  constants: { R_OK: 4, X_OK: 1 },
}))

import * as fs from 'fs/promises'
import { transcribe, validateConfig, getSetting, buildAdvancedArgs } from './whisper'

/** Flush pending microtasks so async mocks can settle */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('whisper service', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    vi.clearAllMocks()
    spawnCallbacks = []
  })

  afterEach(() => {
    db.close()
  })

  function resolveSpawn(index: number, stdout: string) {
    const cb = spawnCallbacks[index]
    if (cb.stdout['data']) cb.stdout['data'](Buffer.from(stdout))
    if (cb.proc['close']) cb.proc['close'](0, null)
  }

  function rejectSpawnEnoent(index: number) {
    const cb = spawnCallbacks[index]
    const err = new Error('spawn error') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    if (cb.proc['error']) cb.proc['error'](err)
  }

  function resolveSpawnExit(index: number, code: number, stderr = '') {
    const cb = spawnCallbacks[index]
    if (stderr && cb.stderr['data']) cb.stderr['data'](Buffer.from(stderr))
    if (cb.proc['close']) cb.proc['close'](code, null)
  }

  function resolveSpawnTimeout(index: number) {
    const cb = spawnCallbacks[index]
    if (cb.proc['close']) cb.proc['close'](null, 'SIGTERM')
  }

  describe('getSetting', () => {
    it('returns setting value from db', () => {
      expect(getSetting(db, 'whisper_binaryPath')).toBe('whisper-cli')
    })

    it('returns empty string for missing key', () => {
      expect(getSetting(db, 'nonexistent_key')).toBe('')
    })
  })

  describe('transcribe', () => {
    it('returns transcribed text on success', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/models/ggml-base.bin')

      const promise = transcribe(db, Buffer.from('fake wav data'))
      await flush() // let writeFile resolve, spawn gets called
      resolveSpawn(0, 'Hello world')

      const result = await promise
      expect(result).toEqual({ text: 'Hello world' })
      expect(mockSpawn).toHaveBeenCalledWith(
        'whisper-cli',
        ['-m', '/models/ggml-base.bin', '-f', expect.stringContaining('agent-voice-'), '--no-timestamps'],
        expect.objectContaining({ timeout: 30000, env: process.env }),
      )
      expect(fs.writeFile).toHaveBeenCalled()
      expect(fs.unlink).toHaveBeenCalled()
    })

    it('throws on empty buffer', async () => {
      await expect(transcribe(db, Buffer.alloc(0))).rejects.toThrow('Empty audio buffer')
    })

    it('throws on buffer too large', async () => {
      const largeBuffer = Buffer.alloc(51 * 1024 * 1024)
      await expect(transcribe(db, largeBuffer)).rejects.toThrow('Audio buffer too large')
    })

    it('throws when model path not configured', async () => {
      await expect(transcribe(db, Buffer.from('data'))).rejects.toThrow(
        'Whisper model path not configured',
      )
    })

    it('throws ENOENT when binary not found', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/models/ggml-base.bin')

      const promise = transcribe(db, Buffer.from('data'))
      await flush()
      rejectSpawnEnoent(0)

      await expect(promise).rejects.toThrow('Whisper binary not found')
    })

    it('throws on non-zero exit code with stderr', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/models/ggml-base.bin')

      const promise = transcribe(db, Buffer.from('data'))
      await flush()
      resolveSpawnExit(0, 1, 'model file not found')

      await expect(promise).rejects.toThrow('Whisper exited with code 1: model file not found')
    })

    it('throws on timeout (SIGTERM)', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/models/ggml-base.bin')

      const promise = transcribe(db, Buffer.from('data'))
      await flush()
      resolveSpawnTimeout(0)

      await expect(promise).rejects.toThrow('timed out')
    })

    it('always cleans up temp file on error', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/models/ggml-base.bin')

      const promise = transcribe(db, Buffer.from('data'))
      await flush()
      resolveSpawnExit(0, 1, 'error')

      await expect(promise).rejects.toThrow()
      expect(fs.unlink).toHaveBeenCalled()
    })

    it('uses custom binary path from settings', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_binaryPath'").run('/opt/whisper/main')
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/models/base.bin')

      const promise = transcribe(db, Buffer.from('data'))
      await flush()
      resolveSpawn(0, 'test')

      await promise
      expect(mockSpawn).toHaveBeenCalledWith('/opt/whisper/main', expect.any(Array), expect.any(Object))
    })
  })

  describe('validateConfig', () => {
    it('returns validation results with model found', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/models/base.bin')
      vi.mocked(fs.access).mockResolvedValue(undefined)

      const promise = validateConfig(db)
      // findBinary spawns `which whisper-cli` — resolve it
      await flush()
      resolveSpawn(0, '/usr/bin/whisper-cli')

      const result = await promise
      expect(result.binaryPath).toBe('whisper-cli')
      expect(result.modelPath).toBe('/models/base.bin')
      expect(result.binaryFound).toBe(true)
      expect(result.modelFound).toBe(true)
    })

    it('returns modelFound false when model file missing', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/nonexistent/model.bin')
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'))

      const promise = validateConfig(db)
      await flush()
      resolveSpawn(0, '/usr/bin/whisper-cli')

      const result = await promise
      expect(result.modelFound).toBe(false)
    })

    it('returns modelFound false when model path empty', async () => {
      const promise = validateConfig(db)
      await flush()
      resolveSpawn(0, '/usr/bin/whisper-cli')

      const result = await promise
      expect(result.modelFound).toBe(false)
      expect(result.modelPath).toBe('')
    })

    it('returns binaryFound false when binary not in PATH', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/models/base.bin')
      vi.mocked(fs.access).mockResolvedValue(undefined)

      const promise = validateConfig(db)
      await flush()
      resolveSpawnExit(0, 1)

      const result = await promise
      expect(result.binaryFound).toBe(false)
    })
  })

  describe('buildAdvancedArgs', () => {
    it('returns empty array when setting is empty', () => {
      expect(buildAdvancedArgs(db)).toEqual([])
    })

    it('returns empty array for invalid JSON', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run('not json')
      expect(buildAdvancedArgs(db)).toEqual([])
    })

    it('returns empty array when all values are defaults', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ language: 'en', threads: 4, bestOf: 5, beamSize: 5, flashAttn: true })
      )
      expect(buildAdvancedArgs(db)).toEqual([])
    })

    it('emits -l for non-default language', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ language: 'fr' })
      )
      expect(buildAdvancedArgs(db)).toEqual(['-l', 'fr'])
    })

    it('emits -tr for translate', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ translate: true })
      )
      expect(buildAdvancedArgs(db)).toEqual(['-tr'])
    })

    it('emits --prompt for non-empty prompt', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ prompt: 'medical terminology' })
      )
      expect(buildAdvancedArgs(db)).toEqual(['--prompt', 'medical terminology'])
    })

    it('emits -t for non-default threads', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ threads: 8 })
      )
      expect(buildAdvancedArgs(db)).toEqual(['-t', '8'])
    })

    it('emits -ng for noGpu', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ noGpu: true })
      )
      expect(buildAdvancedArgs(db)).toEqual(['-ng'])
    })

    it('emits -nfa when flashAttn is explicitly false', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ flashAttn: false })
      )
      expect(buildAdvancedArgs(db)).toEqual(['-nfa'])
    })

    it('emits decoding params when non-default', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ temperature: 0.2, bestOf: 10, beamSize: 8, noSpeechThreshold: 0.4 })
      )
      expect(buildAdvancedArgs(db)).toEqual([
        '-tp', '0.2',
        '-bo', '10',
        '-bs', '8',
        '-nth', '0.4',
      ])
    })

    it('emits -nf for noFallback', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ noFallback: true })
      )
      expect(buildAdvancedArgs(db)).toEqual(['-nf'])
    })

    it('emits --vad with model and threshold', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ vad: true, vadModel: '/models/silero.onnx', vadThreshold: 0.3 })
      )
      expect(buildAdvancedArgs(db)).toEqual([
        '--vad',
        '-vm', '/models/silero.onnx',
        '-vt', '0.3',
      ])
    })

    it('emits --vad alone without model/threshold when defaults', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ vad: true })
      )
      expect(buildAdvancedArgs(db)).toEqual(['--vad'])
    })

    it('does not emit vad sub-params when vad is false', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ vad: false, vadModel: '/models/silero.onnx', vadThreshold: 0.3 })
      )
      expect(buildAdvancedArgs(db)).toEqual([])
    })

    it('combines multiple params in correct order', () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ language: 'auto', translate: true, threads: 2, noGpu: true, temperature: 0.1 })
      )
      const args = buildAdvancedArgs(db)
      expect(args).toContain('-l')
      expect(args).toContain('-tr')
      expect(args).toContain('-t')
      expect(args).toContain('-ng')
      expect(args).toContain('-tp')
      // Verify order: general → performance → decoding
      expect(args.indexOf('-l')).toBeLessThan(args.indexOf('-t'))
      expect(args.indexOf('-t')).toBeLessThan(args.indexOf('-tp'))
    })

    it('passes advanced args to spawn in transcribe', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_modelPath'").run('/models/base.bin')
      db.prepare("UPDATE settings SET value = ? WHERE key = 'whisper_advancedParams'").run(
        JSON.stringify({ language: 'fr', threads: 8 })
      )

      const promise = transcribe(db, Buffer.from('data'))
      await flush()
      resolveSpawn(0, 'Bonjour')

      await promise
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[]
      expect(spawnArgs).toContain('-l')
      expect(spawnArgs).toContain('fr')
      expect(spawnArgs).toContain('-t')
      expect(spawnArgs).toContain('8')
      // Base args still present
      expect(spawnArgs).toContain('-m')
      expect(spawnArgs).toContain('--no-timestamps')
    })
  })
})
