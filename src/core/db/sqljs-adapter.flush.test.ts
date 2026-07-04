/**
 * Durability regression tests for SqlJsAdapter's disk-flush contract (markDirty + flush).
 *
 * The user-facing guarantee these pin: because the desktop runtime gives signal handlers no
 * reliable slice, an ISOLATED write must be on disk the instant it happens (leading edge), a
 * BURST of writes must coalesce onto the 500ms trailing debounce, and every flush must be
 * ATOMIC (temp-sibling + rename) so a death mid-flush never truncates the live DB. See the
 * markDirty()/flush() doc comments in sqljs-adapter.ts.
 *
 * Timing is made deterministic with fake timers + a controlled system clock (the same
 * technique auth/rateLimiter.test.ts uses) rather than wall-clock sleeps.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initAdapter } from './sqljs-adapter'

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqljs-flush-'))
  return path.join(dir, 'agent.db')
}

const CREATE = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)'

afterEach(() => {
  vi.useRealTimers()
})

describe('SqlJsAdapter flush durability', () => {
  it('flushes an isolated write immediately (leading edge, no debounce wait)', async () => {
    const dbPath = tmpDbPath()
    const db = await initAdapter(dbPath)
    try {
      // First write flushes immediately (lastFlushMs=0), creating the file.
      db.exec(CREATE)
      const flushTime = Date.now()

      // Jump >1s past the last flush so the next write is "isolated" → leading-edge flush.
      vi.useFakeTimers()
      vi.setSystemTime(flushTime + 5000)

      db.prepare('INSERT INTO t (v) VALUES (?)').run('alpha')

      // Without advancing any timer, the row must already be durable on disk. If the
      // leading-edge branch were gone (always debounce), this row would only be scheduled
      // for +500ms and reopening now would not see it.
      vi.useRealTimers()
      const reopened = await initAdapter(dbPath)
      try {
        expect(reopened.prepare('SELECT v FROM t WHERE id = 1').get()).toEqual({ v: 'alpha' })
      } finally {
        reopened.close()
      }
    } finally {
      vi.useRealTimers()
      db.close()
    }
  })

  it('coalesces a write within 1s of a flush onto the 500ms debounce', async () => {
    const dbPath = tmpDbPath()
    const db = await initAdapter(dbPath)
    try {
      db.exec(CREATE) // immediate flush
      const flushTime = Date.now()

      // Only 200ms since the last flush → the write must debounce, not write immediately.
      vi.useFakeTimers()
      vi.setSystemTime(flushTime + 200)

      const before = fs.readFileSync(dbPath)
      db.prepare('INSERT INTO t (v) VALUES (?)').run('beta')
      const afterInsert = fs.readFileSync(dbPath)
      // No immediate write: on-disk bytes are unchanged (the row lives only in memory so far).
      expect(afterInsert.equals(before)).toBe(true)

      // The trailing debounce fires the flush.
      vi.advanceTimersByTime(500)

      vi.useRealTimers()
      const reopened = await initAdapter(dbPath)
      try {
        expect(reopened.prepare('SELECT v FROM t WHERE id = 1').get()).toEqual({ v: 'beta' })
      } finally {
        reopened.close()
      }
    } finally {
      vi.useRealTimers()
      db.close()
    }
  })

  it('flushes atomically: no leftover .tmp and the file reopens as a valid DB', async () => {
    const dbPath = tmpDbPath()
    const db = await initAdapter(dbPath)
    try {
      db.exec(CREATE)
      db.prepare('INSERT INTO t (v) VALUES (?)').run('gamma')
      db.flush()

      // The temp sibling was renamed into place, never left behind.
      expect(fs.existsSync(dbPath + '.tmp')).toBe(false)
      expect(fs.existsSync(dbPath)).toBe(true)

      // The renamed file is a well-formed DB carrying the write.
      const reopened = await initAdapter(dbPath)
      try {
        expect(reopened.prepare('SELECT v FROM t WHERE id = 1').get()).toEqual({ v: 'gamma' })
      } finally {
        reopened.close()
      }
    } finally {
      db.close()
    }
  })

  it('flush() with nothing dirty writes nothing (mtime unchanged)', async () => {
    const dbPath = tmpDbPath()
    const db = await initAdapter(dbPath)
    try {
      db.exec(CREATE) // immediate flush → clears the dirty flag
      const mtimeBefore = fs.statSync(dbPath).mtimeMs

      const writeSpy = vi.spyOn(fs, 'writeFileSync')
      db.flush() // nothing dirty → early return

      expect(writeSpy).not.toHaveBeenCalled()
      expect(fs.statSync(dbPath).mtimeMs).toBe(mtimeBefore)
      writeSpy.mockRestore()
    } finally {
      db.close()
    }
  })
})
