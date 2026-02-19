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
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake 3mf data')),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1000 }),
}))

import * as fs from 'fs/promises'
import { compile, validateConfig } from './openscad'

/** Flush pending microtasks so async mocks can settle */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('openscad service', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
    vi.clearAllMocks()
    spawnCallbacks = []
  })

  afterEach(() => {
    db.close()
  })

  function resolveCompile(index: number, stderr = '') {
    const cb = spawnCallbacks[index]
    if (stderr && cb.stderr['data']) cb.stderr['data'](Buffer.from(stderr))
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

  function resolveSpawn(index: number, stdout: string) {
    const cb = spawnCallbacks[index]
    if (cb.stdout['data']) cb.stdout['data'](Buffer.from(stdout))
    if (cb.proc['close']) cb.proc['close'](0, null)
  }

  describe('compile', () => {
    it('returns base64-encoded .3mf on success', async () => {
      const promise = compile(db, '/tmp/test.scad')
      await flush()
      resolveCompile(0)

      const result = await promise
      expect(result.data).toBe(Buffer.from('fake 3mf data').toString('base64'))
      expect(result.warnings).toBe('')
      expect(mockSpawn).toHaveBeenCalledWith(
        'openscad',
        ['-o', expect.stringContaining('agent-openscad-'), '/tmp/test.scad'],
        expect.objectContaining({ timeout: 60000, env: process.env }),
      )
      expect(fs.unlink).toHaveBeenCalled()
    })

    it('returns warnings from stderr on success', async () => {
      const promise = compile(db, '/tmp/test.scad')
      await flush()
      resolveCompile(0, 'WARNING: some deprecation')

      const result = await promise
      expect(result.warnings).toBe('WARNING: some deprecation')
    })

    it('throws ENOENT when binary not found', async () => {
      const promise = compile(db, '/tmp/test.scad')
      await flush()
      rejectSpawnEnoent(0)

      await expect(promise).rejects.toThrow('OpenSCAD binary not found')
    })

    it('throws on non-zero exit code with stderr', async () => {
      const promise = compile(db, '/tmp/test.scad')
      await flush()
      resolveSpawnExit(0, 1, 'ERROR: syntax error')

      await expect(promise).rejects.toThrow('OpenSCAD exited with code 1: ERROR: syntax error')
    })

    it('throws on timeout (SIGTERM)', async () => {
      const promise = compile(db, '/tmp/test.scad')
      await flush()
      resolveSpawnTimeout(0)

      await expect(promise).rejects.toThrow('timed out')
    })

    it('always cleans up temp file on error', async () => {
      const promise = compile(db, '/tmp/test.scad')
      await flush()
      resolveSpawnExit(0, 1, 'error')

      await expect(promise).rejects.toThrow()
      expect(fs.unlink).toHaveBeenCalled()
    })

    it('always cleans up temp file on success', async () => {
      const promise = compile(db, '/tmp/test.scad')
      await flush()
      resolveCompile(0)

      await promise
      expect(fs.unlink).toHaveBeenCalled()
    })

    it('throws when output file is too large', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(Buffer.alloc(51 * 1024 * 1024))

      const promise = compile(db, '/tmp/test.scad')
      await flush()
      resolveCompile(0)

      await expect(promise).rejects.toThrow('Output file too large')
    })

    it('uses custom binary path from settings', async () => {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'openscad_binaryPath'").run('/opt/openscad/bin/openscad')

      const promise = compile(db, '/tmp/test.scad')
      await flush()
      resolveCompile(0)

      await promise
      expect(mockSpawn).toHaveBeenCalledWith('/opt/openscad/bin/openscad', expect.any(Array), expect.any(Object))
    })
  })

  describe('validateConfig', () => {
    it('returns validation results when binary found', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined)

      const promise = validateConfig(db)
      // findBinary spawns `which openscad` — resolve it
      await flush()
      resolveSpawn(0, '/usr/bin/openscad')
      await flush()
      // validateConfig spawns `openscad --version` — resolve it
      resolveSpawn(1, 'OpenSCAD version 2024.12.06')

      const result = await promise
      expect(result.binaryPath).toBe('openscad')
      expect(result.binaryFound).toBe(true)
      expect(result.version).toBe('OpenSCAD version 2024.12.06')
    })

    it('returns binaryFound false when binary not in PATH', async () => {
      const promise = validateConfig(db)
      await flush()
      resolveSpawnExit(0, 1)

      const result = await promise
      expect(result.binaryFound).toBe(false)
      expect(result.version).toBe('')
    })
  })
})
