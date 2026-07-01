/**
 * Headless entry point for Agent Desktop core engine.
 *
 * Runs without Electron — no UI, no BrowserWindow, no tray.
 * Useful for: CLI tools, background services, testing, embedding as a library.
 *
 * Usage:
 *   node out/headless/index.js --server
 *   node out/headless/index.js --discord
 *   node out/headless/index.js --server --discord --port 3484
 *   node out/headless/index.js --tick
 *   node out/headless/index.js --run-task 42
 */

import { resolve, join } from 'path'
import { homedir } from 'os'
import { AgentEngine, noopHookRunner, noopPlatformIO, noopSystemUI } from '../core'
import type { Broadcaster } from '../core'
import { broadcast as coreBroadcast } from '../core/utils/broadcast'
import { setPIBackend } from '../core/services/streaming'
import { streamMessageOmp } from '../core/services/streamingOmp'
import { enrichHeadlessEnv } from './headlessEnv'
import { loadAndRegisterSDK } from './loadSdk'
import { createLogger } from '../core/utils/logger'

const log = createLogger('index')

// ─── CLI parsing ─────────────────────────────────────

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
}

const args = process.argv.slice(2)
const flags = {
  server: args.includes('--server'),
  discord: args.includes('--discord'),
  tick: args.includes('--tick'),
  runTask: args.includes('--run-task'),
  setPassword: args.includes('--set-password'),
  clearPassword: args.includes('--clear-password'),
  port: getArgValue(args, '--port'),
  accessMode: getArgValue(args, '--access-mode') as 'lan' | 'all' | undefined,
}

// ─── Mode validation ─────────────────────────────────

const isLongRunning = flags.server || flags.discord
const isOneShot = flags.tick || flags.runTask || flags.setPassword || flags.clearPassword

function fatal(err: unknown): never {
  log.error('[headless] Fatal:', err)
  process.exit(1)
}

if (isLongRunning && isOneShot) {
  log.error('[headless] Error: --server/--discord cannot be combined with --tick/--run-task')
  process.exit(1)
}

// ─── Paths ───────────────────────────────────────────

const DEFAULT_DB_PATH = join(homedir(), '.config', 'agent-desktop', 'agent.db')
const DEFAULT_THEMES_DIR = join(homedir(), '.agent-desktop', 'themes')
const DEFAULT_SSL_DIR = join(homedir(), '.config', 'agent-desktop', 'ssl')

// ─── CLI dispatch ─────────────────────────────────────

if (isLongRunning) {
  runServices().catch(fatal)
} else if (flags.setPassword || flags.clearPassword) {
  runPasswordMode().catch(fatal)
} else if (isOneShot) {
  import('./taskRunner').then(({ main }) => main(args)).catch(fatal)
} else {
  runInteractive().catch(fatal)
}

// ─── Service mode ─────────────────────────────────────

async function runServices(): Promise<void> {
  enrichHeadlessEnv()
  await loadAndRegisterSDK()
  // Wire PI backend so streamMessage() can dispatch to PI in headless.
  // Window provider + scheduler bridge are intentionally left unset:
  // - winProvider null → PiUIContext falls back to a no-op sink
  // - scheduler bridge null → executeSchedulerCommand throws (handled by `if (schedulerConfig)` guard)
  setPIBackend(streamMessageOmp)

  const dbPath = process.env.AGENT_DB_PATH || DEFAULT_DB_PATH
  const themesDir = process.env.AGENT_THEMES_DIR || DEFAULT_THEMES_DIR
  const sslDir = DEFAULT_SSL_DIR
  const rendererDir = resolve(__dirname, '../renderer')

  log.info(`[headless] Starting Agent Engine...`)
  log.info(`[headless] DB: ${dbPath}`)

  const cleanups: Array<() => void> = []

  // Engine Broadcaster port — forwards `broadcaster.broadcast(…)` calls from
  // handlers (e.g. title updates) through the same fanout utility that
  // `startServer()` hooks to WS clients.
  const broadcaster: Broadcaster = {
    broadcast(channel: string, ...args: unknown[]): void {
      coreBroadcast(channel, ...args)
    },
  }

  const engine = new AgentEngine({
    dbPath: resolve(dbPath),
    themesDir: resolve(themesDir),
    broadcaster,
    hookRunner: noopHookRunner,
    platformIO: noopPlatformIO,
    systemUI: noopSystemUI,
  })

  await engine.init()
  log.info(`[headless] Engine initialized. ${engine.conversations.list().length} conversations in DB.`)

  const dispatch = engine.dispatch

  if (flags.server) {
    const { startServer } = await import('../core/services/webServer')

    // Read server settings from DB, CLI flags override
    const settings = engine.settings.getAll()
    const serverPort = flags.port
      ? parseInt(flags.port, 10)
      : (parseInt(settings.server_port, 10) || 3484)
    const serverAccessMode = flags.accessMode
      || (settings.server_accessMode === 'all' ? 'all' : 'lan')
    const serverShortCode = settings.server_shortCode || undefined

    // CLI overrides pin the corresponding settings for this process lifetime:
    // remote clients (web/Discord) and the local UI cannot mutate them while
    // the headless process is running. The lock is in-memory only; restarting
    // without the override releases it.
    if (flags.port) engine.settings.lockKey('server_port')
    if (flags.accessMode) engine.settings.lockKey('server_accessMode')

    // `startServer` now wires `broadcast()` → WS clients internally.
    const result = await startServer(serverPort, {
      sslDir,
      rendererDir,
      dispatch,
      shortCode: serverShortCode,
      accessMode: serverAccessMode,
      webPassword: engine.webPassword,
    })

    log.info(`[headless] Web server running at ${result.url}`)
    log.info(`[headless] Access token: ${result.token}`)
  }

  if (flags.discord) {
    const { startBot } = await import('../core/services/discord')
    await startBot({ dispatch })
    log.info(`[headless] Discord bot started`)
  }

  // Graceful shutdown
  const shutdown = async () => {
    log.info(`[headless] Shutting down...`)
    for (const cleanup of cleanups) cleanup()
    await engine.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  const running = [flags.server && 'server', flags.discord && 'discord'].filter(Boolean).join(' + ')
  log.info(`[headless] Running: ${running}. Press Ctrl+C to exit.`)
}

// ─── Password mode ────────────────────────────────────

async function runPasswordMode(): Promise<void> {
  const dbPath = process.env.AGENT_DB_PATH || DEFAULT_DB_PATH
  const themesDir = process.env.AGENT_THEMES_DIR || DEFAULT_THEMES_DIR

  const engine = new AgentEngine({
    dbPath: resolve(dbPath),
    themesDir: resolve(themesDir),
    broadcaster: { broadcast: () => {} },
    hookRunner: noopHookRunner,
    platformIO: noopPlatformIO,
    systemUI: noopSystemUI,
  })
  await engine.init()

  try {
    if (flags.clearPassword) {
      await engine.webPassword.clearPassword()
      log.info('Password cleared. Server reverted to token-based authentication.')
    } else {
      if (!process.stdin.isTTY) {
        log.error('--set-password requires a TTY (interactive terminal).')
        process.exit(1)
      }
      const { promptMasked, validatePair } = await import('./passwordPrompt')
      const pwd = await promptMasked({ prompt: 'New password: ', stdin: process.stdin, stdout: process.stdout })
      const confirm = await promptMasked({ prompt: 'Confirm: ', stdin: process.stdin, stdout: process.stdout })
      const err = validatePair(pwd, confirm)
      if (err) { log.error(err); process.exit(1) }
      await engine.webPassword.setPassword(pwd)
      log.info('Password set. Existing sessions invalidated.')
    }
  } finally {
    await engine.shutdown()
  }
}

// ─── Interactive mode ─────────────────────────────────

const consoleBroadcaster: Broadcaster = {
  broadcast(channel: string, data: unknown): void {
    log.debug(`[broadcast] ${channel}: ${JSON.stringify(data, null, 2).slice(0, 200)}`)
  },
}

async function runInteractive(): Promise<void> {
  const dbPath = process.env.AGENT_DB_PATH || DEFAULT_DB_PATH
  const themesDir = process.env.AGENT_THEMES_DIR || DEFAULT_THEMES_DIR

  log.info(`[headless] Starting Agent Engine...`)
  log.info(`[headless] DB: ${dbPath}`)
  log.info(`[headless] Themes: ${themesDir}`)

  const engine = new AgentEngine({
    dbPath: resolve(dbPath),
    themesDir: resolve(themesDir),
    broadcaster: consoleBroadcaster,
    platformIO: noopPlatformIO,
    systemUI: noopSystemUI,
  })

  await engine.init()
  log.info(`[headless] Engine initialized. ${engine.conversations.list().length} conversations in DB.`)

  // Graceful shutdown
  const shutdown = async () => {
    log.info(`[headless] Shutting down...`)
    await engine.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  log.info(`[headless] Engine ready. Press Ctrl+C to exit.`)
  log.info(`[headless] Available services: settings, folders, conversations, messages, tools, shortcuts, themes, mcp, scheduler`)
}
