// omp-native slash-command discovery for the desktop command palette.
//
// Spawns a short-lived omp RPC process, asks it for the commands it knows
// about (builtins + skills + extensions + custom + file-based) via
// `get_available_commands`, and maps them down to the minimal shape the
// palette needs. A denylist drops terminal-only omp builtins that either
// hang (interactive TUI panels) or no-op (headless/dashboard toggles) when
// invoked from the desktop app.

import { findOmpBinary } from './ompLocator'
import { OmpRpcClient } from './ompRpcClient'
import { createLogger, errToCtx } from '../../utils/logger'

const log = createLogger('pi.ompCommands')

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * omp builtins that are terminal-only (TUI panels, headless/dashboard
 * toggles) and would hang or no-op when invoked from the desktop app.
 * Only applied when `source === 'builtin'` — skills/extensions/custom/file
 * commands are never filtered.
 */
const DESKTOP_IRRELEVANT_BUILTINS: Record<string, true> = {
  advisor: true,
  browser: true,
  stats: true,
  fast: true,
  changelog: true,
  share: true,
}

export interface OmpDiscoveredCommand {
  name: string
  description: string
  /** Normalized to the app's SlashCommand.source union (see normalizeSource). */
  source: 'builtin' | 'user' | 'project' | 'skill' | 'macro' | 'extension'
}

/**
 * Map omp's command `source` onto the app's SlashCommand union. omp reports
 * `builtin`/`skill`/`extension` (kept as-is), plus `custom` (a ~/.claude or
 * ~/.omp command) and `file` (a project/.omp command) which the app models as
 * user-authored → `user`. Anything unknown falls back to `user`.
 */
function normalizeSource(source: string): OmpDiscoveredCommand['source'] {
  if (source === 'builtin' || source === 'skill' || source === 'extension') return source
  return 'user'
}

/**
 * Map the raw `get_available_commands` payload (`data.commands`) into the
 * minimal shape the desktop palette needs. Pure — no I/O. Drops entries
 * without a usable `name`, drops desktop-irrelevant builtins, and
 * de-duplicates by name (first occurrence wins).
 */
export function mapOmpCommands(rawCommands: unknown): OmpDiscoveredCommand[] {
  if (!Array.isArray(rawCommands)) return []

  const seen = new Set<string>()
  const out: OmpDiscoveredCommand[] = []
  for (const entry of rawCommands) {
    if (!isRecord(entry)) continue
    const name = typeof entry.name === 'string' ? entry.name : undefined
    if (!name) continue

    const rawSource = typeof entry.source === 'string' ? entry.source : 'user'
    if (rawSource === 'builtin' && DESKTOP_IRRELEVANT_BUILTINS[name]) continue

    if (seen.has(name)) continue
    seen.add(name)

    const description = typeof entry.description === 'string' ? entry.description : ''
    out.push({ name, description, source: normalizeSource(rawSource) })
  }
  return out
}

/**
 * Discover the slash commands omp exposes for the desktop palette.
 * Best-effort: never throws — returns `[]` if the omp binary is missing,
 * discovery fails, or the response is malformed.
 */
export async function discoverOmpCommands(opts: {
  cwd: string
  model?: string
  timeoutMs?: number
}): Promise<OmpDiscoveredCommand[]> {
  const ompPath = findOmpBinary()
  if (!ompPath) {
    log.warn('omp binary not found; returning no commands')
    return []
  }

  const client = new OmpRpcClient({
    ompPath,
    cwd: opts.cwd,
    model: opts.model,
    args: ['--no-session', '--thinking', 'off', '--approval-mode', 'yolo'],
    readyTimeoutMs: opts.timeoutMs ?? 30_000,
  })

  try {
    await client.start()
    const resp = await client.getAvailableCommands()
    if (!resp.success || !isRecord(resp.data)) return []
    return mapOmpCommands(resp.data.commands)
  } catch (err) {
    log.warn('omp command discovery failed', errToCtx(err))
    return []
  } finally {
    client.stop()
  }
}

// ─── Cached discovery ────────────────────────────────────────────────────────
// Each spawn costs ~1.75s (cold Bun-ELF boot). The command palette calls this
// on every `/` keystroke, so an uncached spawn leaves the dropdown empty for
// ~2s and reads as "commands don't appear". Cache by cwd+model with a short TTL
// and dedup in-flight calls. Empty/failed results are NOT cached so a transient
// omp-unavailable never sticks.

interface OmpCommandsCacheEntry { at: number; promise: Promise<OmpDiscoveredCommand[]> }
const commandsCache = new Map<string, OmpCommandsCacheEntry>()
const COMMANDS_TTL_MS = 30_000

/**
 * Cached wrapper over `discoverOmpCommands`. Returns a fresh cached result
 * (< TTL) instantly, dedups concurrent calls, and evicts empty/failed results
 * so the next call retries. Used by the `commands:list` handlers (palette).
 */
export function discoverOmpCommandsCached(opts: {
  cwd: string
  model?: string
  timeoutMs?: number
}): Promise<OmpDiscoveredCommand[]> {
  const key = `${opts.cwd}\u0000${opts.model ?? ''}`
  const now = Date.now()
  const hit = commandsCache.get(key)
  if (hit && now - hit.at < COMMANDS_TTL_MS) return hit.promise

  const promise = discoverOmpCommands(opts)
  commandsCache.set(key, { at: now, promise })
  // Evict on empty/failure so a transient omp-unavailable isn't served for the
  // whole TTL; keep the entry only when it produced real commands.
  promise.then(
    (cmds) => { if (cmds.length === 0 && commandsCache.get(key)?.promise === promise) commandsCache.delete(key) },
    () => { if (commandsCache.get(key)?.promise === promise) commandsCache.delete(key) },
  )
  return promise
}

/** Clear the discovery cache (tests + explicit refresh). */
export function clearOmpCommandsCache(): void {
  commandsCache.clear()
}
