// One-shot omp RPC helper: query session stats (message/token/cost counters)
// and context-usage for an EXISTING session file, outside of a turn — used to
// back a stats panel in the renderer. Mirrors the `ompOneShot.ts` lifecycle
// (spawn → start → query → stop) but resumes a session instead of sending a
// prompt: we only read state, we never drive the agent.

import { findOmpBinary } from './ompLocator'
import { OmpRpcClient } from './ompRpcClient'
import { createLogger } from '../../utils/logger'

const log = createLogger('pi.ompSessionStats')

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function numOr0(v: unknown): number {
  return typeof v === 'number' ? v : 0
}

export interface OmpSessionStats {
  sessionId: string
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: number
  premiumRequests: number
}

export interface OmpContextUsage {
  tokens: number
  contextWindow: number
  percent: number
}

export interface OmpStatsResult {
  stats: OmpSessionStats | null
  contextUsage: OmpContextUsage | null
}

/**
 * Pure narrowing parser for `get_session_stats` response data. Returns null
 * if `data` isn't a record or a required numeric field is absent; a
 * present-but-partial `tokens` sub-object has its missing fields defaulted
 * to 0.
 */
export function parseSessionStats(data: unknown): OmpSessionStats | null {
  if (!isRecord(data)) return null

  const {
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages,
    cost,
    premiumRequests,
    sessionId,
    tokens,
  } = data

  if (
    typeof userMessages !== 'number' ||
    typeof assistantMessages !== 'number' ||
    typeof toolCalls !== 'number' ||
    typeof toolResults !== 'number' ||
    typeof totalMessages !== 'number' ||
    typeof cost !== 'number' ||
    typeof premiumRequests !== 'number'
  ) {
    return null
  }

  const tokensRecord = isRecord(tokens) ? tokens : {}

  return {
    sessionId: typeof sessionId === 'string' ? sessionId : '',
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages,
    tokens: {
      input: numOr0(tokensRecord.input),
      output: numOr0(tokensRecord.output),
      reasoning: numOr0(tokensRecord.reasoning),
      cacheRead: numOr0(tokensRecord.cacheRead),
      cacheWrite: numOr0(tokensRecord.cacheWrite),
      total: numOr0(tokensRecord.total),
    },
    cost,
    premiumRequests,
  }
}

/**
 * Pure narrowing parser for `get_state` response data's `contextUsage`
 * sub-object. Returns null if absent or malformed.
 */
export function parseContextUsage(data: unknown): OmpContextUsage | null {
  if (!isRecord(data)) return null
  const contextUsage = data.contextUsage
  if (!isRecord(contextUsage)) return null

  const { tokens, contextWindow, percent } = contextUsage
  if (typeof tokens !== 'number' || typeof contextWindow !== 'number' || typeof percent !== 'number') {
    return null
  }

  return { tokens, contextWindow, percent }
}

export interface OmpSessionStatsOptions {
  cwd: string
  /** Path to the existing omp session file to resume (`-r <file>`). */
  sessionFile: string
  /** Model id/pattern passed to omp `--model` (fuzzy or provider/id). */
  model?: string
  /** Milliseconds to wait for the `ready` frame before failing (default 30s). */
  timeoutMs?: number
}

/**
 * Resume an existing omp session (no prompt sent) and read back its session
 * stats + context usage. Returns `{ stats: null, contextUsage: null }` if the
 * omp binary is unavailable or the query fails for any reason.
 */
export async function fetchOmpSessionStats(opts: OmpSessionStatsOptions): Promise<OmpStatsResult> {
  const ompPath = findOmpBinary()
  if (!ompPath) {
    return { stats: null, contextUsage: null }
  }

  const client = new OmpRpcClient({
    ompPath,
    cwd: opts.cwd,
    model: opts.model,
    args: ['-r', opts.sessionFile, '--thinking', 'off', '--approval-mode', 'yolo'],
    readyTimeoutMs: opts.timeoutMs ?? 30_000,
  })

  try {
    await client.start()
    const statsResp = await client.getSessionStats()
    const stateResp = await client.getState()
    return {
      stats: parseSessionStats(statsResp.data),
      contextUsage: parseContextUsage(stateResp.data),
    }
  } catch (err) {
    log.warn('omp session stats query failed', { err: err instanceof Error ? err.message : String(err) })
    return { stats: null, contextUsage: null }
  } finally {
    client.stop()
  }
}
