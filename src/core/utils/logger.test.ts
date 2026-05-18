import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LogEntry, LogLevel } from './logger'
import { createLogger, captureLogger, errToCtx } from './logger'

/** A WritableStream stub that records every write and lets us toggle isTTY. */
function makeStream(opts: { isTTY?: boolean } = {}): {
  stream: NodeJS.WritableStream
  writes: string[]
} {
  const writes: string[] = []
  const stream: any = {
    write: (chunk: string) => {
      writes.push(chunk)
      return true
    },
    isTTY: opts.isTTY,
  }
  return { stream, writes }
}

describe('createLogger / level filtering', () => {
  it('emits at and above the requested level', () => {
    const { logger, entries } = captureLogger({ level: 'info' })
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    expect(entries.map((e) => e.level)).toEqual(['info', 'warn', 'error'])
  })

  it('emits everything at trace level', () => {
    const { logger, entries } = captureLogger({ level: 'trace' })
    ;(['trace', 'debug', 'info', 'warn', 'error'] as LogLevel[]).forEach((lvl) =>
      logger[lvl]('msg'),
    )
    expect(entries).toHaveLength(5)
  })

  it('emits nothing below requested level', () => {
    const { logger, entries } = captureLogger({ level: 'error' })
    logger.trace('x')
    logger.debug('x')
    logger.info('x')
    logger.warn('x')
    expect(entries).toHaveLength(0)
  })

  it('warn passes when level is warn', () => {
    const { logger, entries } = captureLogger({ level: 'warn' })
    logger.info('skip')
    logger.warn('go')
    logger.error('go')
    expect(entries.map((e) => e.level)).toEqual(['warn', 'error'])
  })

  it('debug passes when level is debug', () => {
    const { logger, entries } = captureLogger({ level: 'debug' })
    logger.trace('skip')
    logger.debug('go')
    expect(entries.map((e) => e.level)).toEqual(['debug'])
  })
})

describe('short-circuit before serialization', () => {
  it('does not invoke ctx getters when filtered out', () => {
    const { logger } = captureLogger({ level: 'error' })
    const spy = vi.fn()
    const ctx = {
      get expensive() {
        spy()
        return 'value'
      },
    }
    logger.debug('msg', ctx)
    expect(spy).not.toHaveBeenCalled()
  })

  it('invokes ctx getters when level passes', () => {
    const { logger } = captureLogger({ level: 'debug' })
    const spy = vi.fn(() => 'v')
    const ctx = {
      get expensive() {
        return spy()
      },
    }
    logger.debug('msg', ctx)
    expect(spy).toHaveBeenCalled()
  })
})

describe('JSON format', () => {
  it('writes one parseable JSON line per entry on a non-TTY destination', () => {
    const { stream, writes } = makeStream({ isTTY: false })
    const log = createLogger('mod', { destination: stream, level: 'debug' })
    log.info('hello', { a: 1 })
    expect(writes).toHaveLength(1)
    expect(writes[0].endsWith('\n')).toBe(true)
    const parsed = JSON.parse(writes[0]) as LogEntry
    expect(parsed.level).toBe('info')
    expect(parsed.name).toBe('mod')
    expect(parsed.msg).toBe('hello')
    expect(parsed.ctx).toEqual({ a: 1 })
    expect(typeof parsed.ts).toBe('string')
  })

  it('emits stable key ordering: ts, level, name, msg, ctx, err', () => {
    const { stream, writes } = makeStream()
    const log = createLogger('m', { destination: stream, format: 'json', level: 'debug' })
    log.error('boom', new Error('x'), { req: 1 })
    const line = writes[0].trim()
    // Find position of each key in the raw JSON; they must appear in this order.
    const idxTs = line.indexOf('"ts"')
    const idxLevel = line.indexOf('"level"')
    const idxName = line.indexOf('"name"')
    const idxMsg = line.indexOf('"msg"')
    const idxCtx = line.indexOf('"ctx"')
    const idxErr = line.indexOf('"err"')
    expect(idxTs).toBeGreaterThanOrEqual(0)
    expect(idxLevel).toBeGreaterThan(idxTs)
    expect(idxName).toBeGreaterThan(idxLevel)
    expect(idxMsg).toBeGreaterThan(idxName)
    expect(idxCtx).toBeGreaterThan(idxMsg)
    expect(idxErr).toBeGreaterThan(idxCtx)
  })

  it('omits ctx and err keys when absent', () => {
    const { stream, writes } = makeStream()
    const log = createLogger('m', { destination: stream, format: 'json', level: 'debug' })
    log.info('plain')
    const parsed = JSON.parse(writes[0])
    expect(parsed).not.toHaveProperty('ctx')
    expect(parsed).not.toHaveProperty('err')
  })

  it('does not emit ANSI codes in JSON format', () => {
    const { stream, writes } = makeStream()
    const log = createLogger('m', { destination: stream, format: 'json', level: 'debug' })
    log.info('hi', { x: 1 })
    expect(writes[0]).not.toMatch(/\x1b\[/)
  })
})

describe('pretty format', () => {
  it('emits ANSI codes when destination is a TTY', () => {
    const { stream, writes } = makeStream({ isTTY: true })
    const log = createLogger('m', { destination: stream, format: 'pretty', level: 'debug' })
    log.info('hi')
    expect(writes[0]).toMatch(/\x1b\[/)
  })

  it('does not emit ANSI when destination is not a TTY', () => {
    const { stream, writes } = makeStream({ isTTY: false })
    const log = createLogger('m', { destination: stream, format: 'pretty', level: 'debug' })
    log.info('hi')
    expect(writes[0]).not.toMatch(/\x1b\[/)
  })

  it('includes HH:MM:SS.mmm clock, padded LEVEL, name, em dash, and message', () => {
    const { stream, writes } = makeStream({ isTTY: false })
    const log = createLogger('mymod', { destination: stream, format: 'pretty', level: 'debug' })
    log.info('hello world')
    const out = writes[0]
    expect(out).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/)
    expect(out).toContain('INFO')
    expect(out).toContain('mymod')
    expect(out).toContain('—')
    expect(out).toContain('hello world')
  })

  it('uses different colors per level', () => {
    const { stream, writes } = makeStream({ isTTY: true })
    const log = createLogger('m', { destination: stream, format: 'pretty', level: 'trace' })
    log.trace('t')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    // Expect 5 distinct color codes (gray/cyan/green/yellow/red present somewhere).
    const all = writes.join('')
    expect(all).toContain('\x1b[90m') // gray (trace)
    expect(all).toContain('\x1b[36m') // cyan (debug)
    expect(all).toContain('\x1b[32m') // green (info)
    expect(all).toContain('\x1b[33m') // yellow (warn)
    expect(all).toContain('\x1b[31m') // red (error)
  })
})

describe('error() semantics', () => {
  it('serializes Error to {name, message, stack}', () => {
    const { logger, entries } = captureLogger()
    const e = new TypeError('bad input')
    logger.error('failed', e)
    expect(entries[0].err?.name).toBe('TypeError')
    expect(entries[0].err?.message).toBe('bad input')
    expect(typeof entries[0].err?.stack).toBe('string')
  })

  it('serializes a string err as {name:Error, message:str}', () => {
    const { logger, entries } = captureLogger()
    logger.error('failed', 'string-error')
    expect(entries[0].err).toEqual({ name: 'Error', message: 'string-error' })
  })

  it('serializes unknown err with value field', () => {
    const { logger, entries } = captureLogger()
    logger.error('failed', { code: 42 })
    expect(entries[0].err?.name).toBe('Error')
    expect(entries[0].err?.value).toEqual({ code: 42 })
  })

  it('omits err entirely when undefined', () => {
    const { logger, entries } = captureLogger()
    logger.error('just a message')
    expect(entries[0].err).toBeUndefined()
  })

  it('keeps ctx separate from err', () => {
    const { logger, entries } = captureLogger()
    logger.error('failed', new Error('x'), { reqId: 'abc' })
    expect(entries[0].ctx).toEqual({ reqId: 'abc' })
    expect(entries[0].err?.message).toBe('x')
  })
})

describe('child()', () => {
  it('merges bindings into every emitted ctx', () => {
    const { logger, entries } = captureLogger()
    const child = logger.child({ reqId: 'abc' })
    child.info('first')
    child.info('second', { extra: 1 })
    expect(entries[0].ctx).toEqual({ reqId: 'abc' })
    expect(entries[1].ctx).toEqual({ reqId: 'abc', extra: 1 })
  })

  it('per-call ctx wins on conflict', () => {
    const { logger, entries } = captureLogger()
    const child = logger.child({ reqId: 'parent' })
    child.info('msg', { reqId: 'override' })
    expect(entries[0].ctx).toEqual({ reqId: 'override' })
  })

  it('nested children compose bindings', () => {
    const { logger, entries } = captureLogger()
    const a = logger.child({ a: 1 })
    const b = a.child({ b: 2 })
    const c = b.child({ c: 3 })
    c.info('msg')
    expect(entries[0].ctx).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('parent is unaffected by child bindings', () => {
    const { logger, entries } = captureLogger()
    const child = logger.child({ reqId: 'abc' })
    child.info('child')
    logger.info('parent')
    expect(entries[0].ctx).toEqual({ reqId: 'abc' })
    expect(entries[1].ctx).toBeUndefined()
  })

  it('child inherits level filtering from parent', () => {
    const { logger, entries } = captureLogger({ level: 'warn' })
    const child = logger.child({ x: 1 })
    child.info('skip')
    child.warn('go')
    expect(entries.map((e) => e.level)).toEqual(['warn'])
  })
})

describe('captureLogger()', () => {
  it('returns a typed array of full LogEntry records', () => {
    const { logger, entries } = captureLogger({ name: 'test-mod' })
    logger.info('hello', { x: 1 })
    logger.error('boom', new Error('e'), { y: 2 })
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      level: 'info',
      name: 'test-mod',
      msg: 'hello',
      ctx: { x: 1 },
    })
    expect(entries[1]).toMatchObject({
      level: 'error',
      name: 'test-mod',
      msg: 'boom',
      ctx: { y: 2 },
    })
    expect(entries[1].err?.message).toBe('e')
  })

  it('captures timestamps as ISO strings', () => {
    const { logger, entries } = captureLogger()
    logger.info('msg')
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('captures across child loggers', () => {
    const { logger, entries } = captureLogger()
    logger.info('parent')
    logger.child({ a: 1 }).info('child')
    expect(entries).toHaveLength(2)
    expect(entries[1].ctx).toEqual({ a: 1 })
  })
})

describe('createLogger defaults', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL
  })

  it('honors LOG_LEVEL env var when set', () => {
    process.env.LOG_LEVEL = 'warn'
    const { stream, writes } = makeStream()
    const log = createLogger('m', { destination: stream })
    log.info('skip')
    log.warn('go')
    expect(writes).toHaveLength(1)
    delete process.env.LOG_LEVEL
  })

  it('ignores invalid LOG_LEVEL values', () => {
    process.env.LOG_LEVEL = 'verbose'
    const { stream, writes } = makeStream()
    // Falls back to dev/prod default → debug or info; both pass for warn.
    const log = createLogger('m', { destination: stream })
    log.warn('go')
    expect(writes).toHaveLength(1)
    delete process.env.LOG_LEVEL
  })

  it('defaults to JSON when destination has no isTTY', () => {
    const { stream, writes } = makeStream() // no isTTY
    const log = createLogger('m', { destination: stream, level: 'debug' })
    log.info('msg')
    // JSON output starts with `{`
    expect(writes[0].startsWith('{')).toBe(true)
    expect(() => JSON.parse(writes[0])).not.toThrow()
  })

  it('defaults to pretty when destination is a TTY', () => {
    const { stream, writes } = makeStream({ isTTY: true })
    const log = createLogger('m', { destination: stream, level: 'debug' })
    log.info('msg')
    expect(writes[0]).toMatch(/\x1b\[/)
  })

  it('routes warn/error to the same destination when only one is supplied', () => {
    const { stream, writes } = makeStream()
    const log = createLogger('m', { destination: stream, level: 'debug' })
    log.error('boom')
    expect(writes).toHaveLength(1)
  })
})

describe('renderer / browser fallback (no process.stdout)', () => {
  it('falls back to console without throwing when process.stdout is undefined', () => {
    const originalStdout = process.stdout
    const originalStderr = process.stderr
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Simulate Electron renderer: process exists but stdout/stderr are undefined
      Object.defineProperty(process, 'stdout', { value: undefined, configurable: true })
      Object.defineProperty(process, 'stderr', { value: undefined, configurable: true })

      // Must not throw
      const log = createLogger('renderer-store', { level: 'debug' })
      log.info('settings loaded', { count: 12 })
      log.error('save failed', new Error('quota exceeded'))

      expect(consoleLog).toHaveBeenCalled()
      expect(consoleError).toHaveBeenCalled()
      // Verify the JSON shape made it through (msg + ctx for info)
      const infoLine = consoleLog.mock.calls[0][0] as string
      const parsed = JSON.parse(infoLine)
      expect(parsed.level).toBe('info')
      expect(parsed.name).toBe('renderer-store')
      expect(parsed.msg).toBe('settings loaded')
      expect(parsed.ctx).toEqual({ count: 12 })
    } finally {
      Object.defineProperty(process, 'stdout', { value: originalStdout, configurable: true })
      Object.defineProperty(process, 'stderr', { value: originalStderr, configurable: true })
      consoleLog.mockRestore()
      consoleError.mockRestore()
    }
  })
})

describe('integration smoke', () => {
  it('round-trips a realistic record: ctx merging + error + name', () => {
    const { logger, entries } = captureLogger({ name: 'streaming' })
    const conv = logger.child({ conversationId: 7 })
    const err = new Error('SDK exit 1')
    conv.error('stream failed', err, { turn: 3 })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      level: 'error',
      name: 'streaming',
      msg: 'stream failed',
      ctx: { conversationId: 7, turn: 3 },
    })
    expect(entries[0].err?.message).toBe('SDK exit 1')
  })

  it('does not throw when called with an undefined ctx', () => {
    const { logger, entries } = captureLogger()
    expect(() => logger.info('no ctx')).not.toThrow()
    expect(entries[0].ctx).toBeUndefined()
  })

  it('does not throw on empty ctx object', () => {
    const { logger, entries } = captureLogger()
    logger.info('msg', {})
    expect(entries[0].ctx).toBeUndefined()
  })
})

describe('errToCtx', () => {
  it('serializes an Error to { error: "Name: message" }', () => {
    const e = new TypeError('boom')
    expect(errToCtx(e)).toEqual({ error: 'TypeError: boom' })
  })

  it('stringifies non-Error values', () => {
    expect(errToCtx('plain string')).toEqual({ error: 'plain string' })
    expect(errToCtx(42)).toEqual({ error: '42' })
  })

  it('merges extra fields alongside the error', () => {
    const e = new Error('nope')
    expect(errToCtx(e, { taskId: 7 })).toEqual({ error: 'Error: nope', taskId: 7 })
  })

  it('survives the warn() ctx filter that drops raw Error objects', () => {
    const { logger, entries } = captureLogger()
    // Regression: log.warn('x', err) silently dropped the Error because an
    // Error's keys are non-enumerable. errToCtx makes the cause visible.
    logger.warn('op failed, using fallback', errToCtx(new Error('root cause')))
    expect(entries).toHaveLength(1)
    expect(entries[0].ctx).toEqual({ error: 'Error: root cause' })
  })
})
