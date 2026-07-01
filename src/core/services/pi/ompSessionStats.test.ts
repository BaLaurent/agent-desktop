/**
 * Coverage for `ompSessionStats`: the pure `parseSessionStats`/`parseContextUsage`
 * narrowing parsers, and `fetchOmpSessionStats`'s one-shot resume-and-query
 * lifecycle. The transport (`OmpRpcClient`) and binary lookup (`ompLocator`)
 * are mocked — no real omp subprocess is spawned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findOmpBinary, ctorMock, start, stop, getSessionStats, getState } = vi.hoisted(() => ({
  findOmpBinary: vi.fn(),
  ctorMock: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  getSessionStats: vi.fn(),
  getState: vi.fn(),
}))

vi.mock('./ompLocator', () => ({ findOmpBinary }))
vi.mock('./ompRpcClient', () => ({
  OmpRpcClient: class {
    constructor(options: unknown) {
      ctorMock(options)
    }
    start = start
    stop = stop
    getSessionStats = getSessionStats
    getState = getState
  },
}))

import { parseSessionStats, parseContextUsage, fetchOmpSessionStats } from './ompSessionStats'

const FULL_STATS = {
  sessionId: 'sess-1',
  userMessages: 2,
  assistantMessages: 3,
  toolCalls: 4,
  toolResults: 4,
  totalMessages: 9,
  tokens: { input: 100, output: 200, reasoning: 10, cacheRead: 5, cacheWrite: 1, total: 316 },
  cost: 0.42,
  premiumRequests: 1,
}

const FULL_STATE = {
  contextUsage: { tokens: 1000, contextWindow: 200_000, percent: 0.5 },
}

beforeEach(() => {
  findOmpBinary.mockReset()
  ctorMock.mockReset()
  start.mockReset()
  stop.mockReset()
  getSessionStats.mockReset()
  getState.mockReset()
})

describe('parseSessionStats', () => {
  it('parses a full valid payload', () => {
    expect(parseSessionStats(FULL_STATS)).toEqual(FULL_STATS)
  })

  it('returns null for a non-record', () => {
    expect(parseSessionStats(null)).toBeNull()
    expect(parseSessionStats('nope')).toBeNull()
    expect(parseSessionStats(42)).toBeNull()
    expect(parseSessionStats(undefined)).toBeNull()
  })

  it('returns null when a required numeric field is missing', () => {
    const { userMessages: _userMessages, ...rest } = FULL_STATS
    expect(parseSessionStats(rest)).toBeNull()
  })

  it('returns null when a required numeric field has the wrong type', () => {
    expect(parseSessionStats({ ...FULL_STATS, cost: 'free' })).toBeNull()
  })

  it('defaults partial tokens sub-fields to 0', () => {
    const result = parseSessionStats({ ...FULL_STATS, tokens: { total: 50 } })
    expect(result?.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 50 })
  })

  it('defaults tokens to all zeros when the sub-object is entirely absent', () => {
    const { tokens: _tokens, ...rest } = FULL_STATS
    const result = parseSessionStats(rest)
    expect(result?.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 })
  })

  it('defaults sessionId to empty string when missing', () => {
    const { sessionId: _sessionId, ...rest } = FULL_STATS
    const result = parseSessionStats(rest)
    expect(result?.sessionId).toBe('')
  })
})

describe('parseContextUsage', () => {
  it('parses a valid contextUsage payload', () => {
    expect(parseContextUsage(FULL_STATE)).toEqual(FULL_STATE.contextUsage)
  })

  it('returns null when contextUsage is absent', () => {
    expect(parseContextUsage({})).toBeNull()
  })

  it('returns null for a non-record', () => {
    expect(parseContextUsage(null)).toBeNull()
    expect(parseContextUsage(42)).toBeNull()
  })

  it('returns null when contextUsage numeric fields are malformed', () => {
    expect(parseContextUsage({ contextUsage: { tokens: '1000', contextWindow: 200_000, percent: 0.5 } })).toBeNull()
  })
})

describe('fetchOmpSessionStats', () => {
  it('returns parsed stats and contextUsage from fake responses, and spawns with the resume args', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    start.mockResolvedValue(undefined)
    getSessionStats.mockResolvedValue({ type: 'response', command: 'get_session_stats', success: true, data: FULL_STATS })
    getState.mockResolvedValue({ type: 'response', command: 'get_state', success: true, data: FULL_STATE })

    const result = await fetchOmpSessionStats({ cwd: '/proj', sessionFile: '/proj/.omp/session.json' })

    expect(result.stats).toEqual(FULL_STATS)
    expect(result.contextUsage).toEqual(FULL_STATE.contextUsage)
    expect(ctorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ompPath: '/fake/omp',
        cwd: '/proj',
        args: ['-r', '/proj/.omp/session.json', '--thinking', 'off', '--approval-mode', 'yolo'],
        readyTimeoutMs: 30_000,
      }),
    )
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('honors a custom timeoutMs', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    start.mockResolvedValue(undefined)
    getSessionStats.mockResolvedValue({ type: 'response', command: 'get_session_stats', success: true, data: FULL_STATS })
    getState.mockResolvedValue({ type: 'response', command: 'get_state', success: true, data: FULL_STATE })

    await fetchOmpSessionStats({ cwd: '/proj', sessionFile: '/proj/.omp/session.json', timeoutMs: 5000 })

    expect(ctorMock).toHaveBeenCalledWith(expect.objectContaining({ readyTimeoutMs: 5000 }))
  })

  it('returns nulls and never starts the client when findOmpBinary returns null', async () => {
    findOmpBinary.mockReturnValue(null)

    const result = await fetchOmpSessionStats({ cwd: '/proj', sessionFile: '/proj/.omp/session.json' })

    expect(result).toEqual({ stats: null, contextUsage: null })
    expect(ctorMock).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('returns nulls when start() throws, and still calls stop()', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    start.mockRejectedValue(new Error('spawn failed'))

    const result = await fetchOmpSessionStats({ cwd: '/proj', sessionFile: '/proj/.omp/session.json' })

    expect(result).toEqual({ stats: null, contextUsage: null })
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('returns nulls when getSessionStats() throws, and still calls stop()', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    start.mockResolvedValue(undefined)
    getSessionStats.mockRejectedValue(new Error('rpc failed'))
    getState.mockResolvedValue({ type: 'response', command: 'get_state', success: true, data: FULL_STATE })

    const result = await fetchOmpSessionStats({ cwd: '/proj', sessionFile: '/proj/.omp/session.json' })

    expect(result).toEqual({ stats: null, contextUsage: null })
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
