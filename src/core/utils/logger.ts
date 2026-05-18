/**
 * Structured logger for `src/core/` (Electron main + headless + tests).
 *
 * Why custom (no pino/winston):
 *  - Must run in node (main, headless), jsdom (renderer tests), and ad-hoc CLI.
 *  - External loggers ship transports that pull in `fs`/`stream` features that
 *    misbehave under jsdom or in renderer bundles.
 *  - We need ~50 LOC of behavior; a dependency would weigh more than the code.
 *
 * Design notes:
 *  - Level filtering short-circuits BEFORE serializing context (hot path: streaming).
 *  - Pretty format only emits ANSI when destination is a real TTY.
 *  - JSON format is the default for non-TTY (pipes, files, jsdom, CI).
 *  - `error(msg, err, ctx)` keeps `err` separate from `ctx` so structured sinks can index it.
 *  - `child(bindings)` shares the parent's runtime config (level, format, destination)
 *    so a top-level `setLevel`-style mutation would propagate; we keep config immutable
 *    for now and revisit if a need appears.
 *  - Renderer→main IPC bridge intentionally NOT implemented: renderer logs go to the
 *    browser devtools console. Future work: `src/main/services/loggerBridge.ts`.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  trace(msg: string, ctx?: object): void
  debug(msg: string, ctx?: object): void
  info(msg: string, ctx?: object): void
  warn(msg: string, ctx?: object): void
  error(msg: string, err?: unknown, ctx?: object): void
  child(bindings: object): Logger
}

export interface LoggerOptions {
  level?: LogLevel
  format?: 'pretty' | 'json'
  destination?: NodeJS.WritableStream
}

export interface LogEntry {
  ts: string
  level: LogLevel
  name: string
  msg: string
  ctx?: Record<string, unknown>
  err?: { name: string; message: string; stack?: string; value?: unknown }
}

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
}

const ANSI = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
} as const

const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: ANSI.gray,
  debug: ANSI.cyan,
  info: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
}

/** Resolve default level from env, falling back to dev/prod heuristic. */
function defaultLevel(): LogLevel {
  const env = (typeof process !== 'undefined' ? process.env?.LOG_LEVEL : undefined)?.toLowerCase()
  if (env === 'trace' || env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env
  }
  const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined
  return nodeEnv === 'production' ? 'info' : 'debug'
}

/** Detect whether to use pretty format. JSON wins unless we know we're on a TTY. */
function defaultFormat(dest: NodeJS.WritableStream): 'pretty' | 'json' {
  // `isTTY` is `true` only on real terminals; `undefined` under jsdom + most tests.
  const isTty = (dest as unknown as { isTTY?: boolean }).isTTY === true
  return isTty ? 'pretty' : 'json'
}

/** Format wall-clock as HH:MM:SS.mmm for pretty output. */
function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

/** Serialize an unknown error-ish value into a stable shape. */
function serializeErr(err: unknown): LogEntry['err'] {
  if (err === undefined) return undefined
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  if (typeof err === 'string') {
    return { name: 'Error', message: err }
  }
  return { name: 'Error', message: String(err), value: err }
}

/**
 * Render a caught value as a log `ctx` field. Only `error(msg, err, ctx)`
 * has a dedicated `err` parameter; `warn/info/debug/trace` take `(msg, ctx)`
 * and would silently drop an `Error` (its `name/message/stack` are
 * non-enumerable, so `Object.keys` is empty and the ctx is discarded).
 * Use this at non-`error` levels for recoverable fallbacks:
 * `log.warn('X failed, using fallback', errToCtx(err))`.
 */
export function errToCtx(err: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return extra ? { ...extra, error } : { error }
}

/** Stable JSON serialization with deterministic key ordering. */
function stableJson(entry: LogEntry): string {
  // Manual ordered emission keeps key order deterministic across Node versions.
  const parts: string[] = []
  parts.push(`"ts":${JSON.stringify(entry.ts)}`)
  parts.push(`"level":${JSON.stringify(entry.level)}`)
  parts.push(`"name":${JSON.stringify(entry.name)}`)
  parts.push(`"msg":${JSON.stringify(entry.msg)}`)
  if (entry.ctx !== undefined) parts.push(`"ctx":${JSON.stringify(entry.ctx)}`)
  if (entry.err !== undefined) parts.push(`"err":${JSON.stringify(entry.err)}`)
  return `{${parts.join(',')}}`
}

interface InternalConfig {
  name: string
  level: LogLevel
  format: 'pretty' | 'json'
  destination: NodeJS.WritableStream
  errorDestination: NodeJS.WritableStream
  bindings: Record<string, unknown>
  /** Optional sink that bypasses the formatter — used by `captureLogger()` for tests. */
  capture?: (entry: LogEntry) => void
}

function shouldEmit(cfg: InternalConfig, level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[cfg.level]
}

function formatPretty(entry: LogEntry, useColor: boolean): string {
  const time = formatClock(new Date(entry.ts))
  const level = entry.level.toUpperCase().padEnd(5, ' ')
  const ctxStr = entry.ctx ? ` ${JSON.stringify(entry.ctx)}` : ''
  const errStr = entry.err
    ? ` ${JSON.stringify(entry.err)}`
    : ''
  if (!useColor) {
    return `${time} ${level} ${entry.name} — ${entry.msg}${ctxStr}${errStr}\n`
  }
  const color = LEVEL_COLOR[entry.level]
  return (
    `${ANSI.gray}${time}${ANSI.reset} ` +
    `${color}${ANSI.bold}${level}${ANSI.reset} ` +
    `${ANSI.gray}${entry.name}${ANSI.reset} — ` +
    `${entry.msg}${ANSI.gray}${ctxStr}${errStr}${ANSI.reset}\n`
  )
}

function emit(
  cfg: InternalConfig,
  level: LogLevel,
  msg: string,
  err: unknown,
  ctx: object | undefined,
): void {
  if (!shouldEmit(cfg, level)) return

  // Merge bindings + per-call ctx. Per-call wins on conflict.
  let mergedCtx: Record<string, unknown> | undefined
  const hasBindings = Object.keys(cfg.bindings).length > 0
  const hasCtx = ctx !== undefined && Object.keys(ctx).length > 0
  if (hasBindings && hasCtx) {
    mergedCtx = { ...cfg.bindings, ...(ctx as Record<string, unknown>) }
  } else if (hasBindings) {
    mergedCtx = { ...cfg.bindings }
  } else if (hasCtx) {
    mergedCtx = { ...(ctx as Record<string, unknown>) }
  }

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    name: cfg.name,
    msg,
    ...(mergedCtx !== undefined ? { ctx: mergedCtx } : {}),
    ...(err !== undefined ? { err: serializeErr(err) } : {}),
  }

  if (cfg.capture) {
    cfg.capture(entry)
    return
  }

  const target = level === 'error' || level === 'warn' ? cfg.errorDestination : cfg.destination
  const useColor =
    cfg.format === 'pretty' && (target as unknown as { isTTY?: boolean }).isTTY === true
  const line = cfg.format === 'pretty' ? formatPretty(entry, useColor) : stableJson(entry) + '\n'
  target.write(line)
}

function makeLogger(cfg: InternalConfig): Logger {
  return {
    trace: (msg, ctx) => emit(cfg, 'trace', msg, undefined, ctx),
    debug: (msg, ctx) => emit(cfg, 'debug', msg, undefined, ctx),
    info: (msg, ctx) => emit(cfg, 'info', msg, undefined, ctx),
    warn: (msg, ctx) => emit(cfg, 'warn', msg, undefined, ctx),
    error: (msg, err, ctx) => emit(cfg, 'error', msg, err, ctx),
    child: (bindings) =>
      makeLogger({
        ...cfg,
        bindings: { ...cfg.bindings, ...(bindings as Record<string, unknown>) },
      }),
  }
}

/**
 * Build a minimal WritableStream-like adapter that routes writes through a
 * console method. Used in environments where `process.stdout`/`process.stderr`
 * are unavailable (Electron renderer, browser bundles, web workers).
 *
 * The logger's `emit()` writes a single line ending in `\n` per record; we
 * strip the trailing newline because the browser console adds one already.
 */
function makeConsoleStream(method: (...args: unknown[]) => void): NodeJS.WritableStream {
  const stream = {
    write(chunk: string | Buffer): boolean {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      method(str.replace(/\n$/, ''))
      return true
    },
  } as unknown as NodeJS.WritableStream
  return stream
}

/**
 * Create a structured logger.
 *
 * The `name` is emitted with every record so cross-module log streams remain
 * grep-able. Use `child()` to add request/conversation/etc. bindings rather
 * than spawning new top-level loggers per call site.
 *
 * Destination resolution (in order):
 *   1. opts.destination if provided
 *   2. process.stdout / process.stderr if available (Node, jsdom)
 *   3. console.log / console.error fallback (Electron renderer, browser)
 *
 * Never throws on init — the renderer process exposes `process` but
 * `process.stdout` is undefined; we route to DevTools console there.
 */
export function createLogger(name: string, opts: LoggerOptions = {}): Logger {
  const stdout =
    typeof process !== 'undefined' && process.stdout ? process.stdout : undefined
  const stderr =
    typeof process !== 'undefined' && process.stderr ? process.stderr : undefined

  const destination =
    opts.destination ??
    stdout ??
    makeConsoleStream((...args) => {
      // eslint-disable-next-line no-console
      console.log(...args)
    })

  const errorDestination =
    opts.destination ??
    stderr ??
    makeConsoleStream((...args) => {
      // eslint-disable-next-line no-console
      console.error(...args)
    })

  const cfg: InternalConfig = {
    name,
    level: opts.level ?? defaultLevel(),
    format: opts.format ?? defaultFormat(destination),
    destination,
    errorDestination,
    bindings: {},
  }
  return makeLogger(cfg)
}

/**
 * Test fixture: returns a logger that captures every entry into an array
 * instead of writing to a stream. Levels still filter the same way as a
 * real logger, so consumer code under test sees realistic behavior.
 *
 * Reason for suppress: consumed only by *.test.ts files which are in
 * fallow's ignorePatterns, so fallow can't see those consumers and
 * flags this as unused.
 */
// fallow-ignore-next-line unused-export
export function captureLogger(opts: { level?: LogLevel; name?: string } = {}): {
  logger: Logger
  entries: LogEntry[]
} {
  const entries: LogEntry[] = []
  const stub: NodeJS.WritableStream = {
    write: () => true,
  } as unknown as NodeJS.WritableStream
  const cfg: InternalConfig = {
    name: opts.name ?? 'test',
    level: opts.level ?? 'trace',
    format: 'json',
    destination: stub,
    errorDestination: stub,
    bindings: {},
    capture: (e) => entries.push(e),
  }
  return { logger: makeLogger(cfg), entries }
}
