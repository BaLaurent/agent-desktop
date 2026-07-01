/**
 * Coverage for `ompCommands`: the pure `mapOmpCommands` filter/dedupe logic
 * and `discoverOmpCommands`'s one-shot RPC lifecycle. The transport
 * (OmpRpcClient) and binary resolution (ompLocator) are mocked — no real
 * subprocess is involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findOmpBinary } = vi.hoisted(() => ({ findOmpBinary: vi.fn() }))
vi.mock('./ompLocator', () => ({ findOmpBinary }))

const { OmpRpcClient, start, stop, getAvailableCommands } = vi.hoisted(() => {
  const start = vi.fn().mockResolvedValue(undefined)
  const stop = vi.fn()
  const getAvailableCommands = vi.fn()
  const OmpRpcClient = vi.fn().mockImplementation(function () {
    return { start, stop, getAvailableCommands }
  })
  return { OmpRpcClient, start, stop, getAvailableCommands }
})
vi.mock('./ompRpcClient', () => ({ OmpRpcClient }))

import { mapOmpCommands, discoverOmpCommands, discoverOmpCommandsCached, clearOmpCommandsCache } from './ompCommands'

beforeEach(() => {
  findOmpBinary.mockReset()
  OmpRpcClient.mockClear()
  start.mockReset().mockResolvedValue(undefined)
  stop.mockReset()
  getAvailableCommands.mockReset()
  clearOmpCommandsCache()
})

describe('mapOmpCommands', () => {
  it('keeps a builtin like context', () => {
    const out = mapOmpCommands([{ name: 'context', description: 'Show context usage', source: 'builtin' }])
    expect(out).toEqual([{ name: 'context', description: 'Show context usage', source: 'builtin' }])
  })

  it('drops denylisted builtin commands (browser, advisor, stats)', () => {
    const out = mapOmpCommands([
      { name: 'browser', description: 'Open dashboard', source: 'builtin' },
      { name: 'advisor', description: 'Advisor panel', source: 'builtin' },
      { name: 'stats', description: 'Session stats TUI', source: 'builtin' },
      { name: 'context', description: 'Show context usage', source: 'builtin' },
    ])
    expect(out).toEqual([{ name: 'context', description: 'Show context usage', source: 'builtin' }])
  })

  it('keeps a skill-sourced command even if its name collides with a denylisted builtin', () => {
    const out = mapOmpCommands([{ name: 'skill:foo', description: 'A skill', source: 'skill' }])
    expect(out).toEqual([{ name: 'skill:foo', description: 'A skill', source: 'skill' }])
  })

  it('normalizes custom and file sources to user', () => {
    const out = mapOmpCommands([
      { name: 'my-custom', description: 'Custom command', source: 'custom' },
      { name: 'my-file', description: 'File command', source: 'file' },
    ])
    expect(out).toEqual([
      { name: 'my-custom', description: 'Custom command', source: 'user' },
      { name: 'my-file', description: 'File command', source: 'user' },
    ])
  })

  it('never applies the denylist to non-builtin sources named like a denylisted builtin', () => {
    const out = mapOmpCommands([{ name: 'browser', description: 'An extension named browser', source: 'extension' }])
    expect(out).toEqual([{ name: 'browser', description: 'An extension named browser', source: 'extension' }])
  })

  it('defaults a missing description to an empty string', () => {
    const out = mapOmpCommands([{ name: 'todo', source: 'builtin' }])
    expect(out).toEqual([{ name: 'todo', description: '', source: 'builtin' }])
  })

  it('skips entries with no name', () => {
    const out = mapOmpCommands([
      { description: 'nameless', source: 'builtin' },
      { name: 42, description: 'non-string name', source: 'builtin' },
      { name: 'context', description: 'Show context usage', source: 'builtin' },
    ])
    expect(out).toEqual([{ name: 'context', description: 'Show context usage', source: 'builtin' }])
  })

  it('de-dupes by name, first occurrence wins', () => {
    const out = mapOmpCommands([
      { name: 'compact', description: 'first', source: 'builtin' },
      { name: 'compact', description: 'second', source: 'custom' },
    ])
    expect(out).toEqual([{ name: 'compact', description: 'first', source: 'builtin' }])
  })

  it('returns [] for non-array input', () => {
    expect(mapOmpCommands(undefined)).toEqual([])
    expect(mapOmpCommands({ commands: [] })).toEqual([])
  })
})

describe('discoverOmpCommands', () => {
  it('returns mapped commands on a successful response', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    getAvailableCommands.mockResolvedValue({
      type: 'response',
      command: 'get_available_commands',
      success: true,
      data: {
        commands: [
          { name: 'context', description: 'Show context usage', source: 'builtin' },
          { name: 'browser', description: 'Open dashboard', source: 'builtin' },
          { name: 'skill:foo', description: 'A skill', source: 'skill' },
        ],
      },
    })

    const result = await discoverOmpCommands({ cwd: '/tmp' })

    expect(result).toEqual([
      { name: 'context', description: 'Show context usage', source: 'builtin' },
      { name: 'skill:foo', description: 'A skill', source: 'skill' },
    ])
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('returns [] and never constructs/starts a client when the omp binary is not found', async () => {
    findOmpBinary.mockReturnValue(null)

    const result = await discoverOmpCommands({ cwd: '/tmp' })

    expect(result).toEqual([])
    expect(OmpRpcClient).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('returns [] when the response is success:false', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    getAvailableCommands.mockResolvedValue({
      type: 'response',
      command: 'get_available_commands',
      success: false,
      error: 'boom',
    })

    const result = await discoverOmpCommands({ cwd: '/tmp' })

    expect(result).toEqual([])
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('returns [] when the response data is malformed', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    getAvailableCommands.mockResolvedValue({
      type: 'response',
      command: 'get_available_commands',
      success: true,
      data: 'not-a-record',
    })

    const result = await discoverOmpCommands({ cwd: '/tmp' })

    expect(result).toEqual([])
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('calls client.stop() even when start() throws', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    start.mockRejectedValue(new Error('spawn failed'))

    const result = await discoverOmpCommands({ cwd: '/tmp' })

    expect(result).toEqual([])
    expect(stop).toHaveBeenCalledTimes(1)
  })
})

describe('discoverOmpCommandsCached', () => {
  it('serves a second call within TTL from cache without re-spawning', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    getAvailableCommands.mockResolvedValue({
      success: true, data: { commands: [{ name: 'context', description: 'c', source: 'builtin' }] },
    })

    const first = await discoverOmpCommandsCached({ cwd: '/tmp' })
    const second = await discoverOmpCommandsCached({ cwd: '/tmp' })

    expect(first).toEqual(second)
    expect(OmpRpcClient).toHaveBeenCalledTimes(1) // only one spawn
  })

  it('dedups concurrent in-flight calls into a single spawn', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    getAvailableCommands.mockResolvedValue({
      success: true, data: { commands: [{ name: 'context', description: 'c', source: 'builtin' }] },
    })

    const [a, b] = await Promise.all([
      discoverOmpCommandsCached({ cwd: '/tmp' }),
      discoverOmpCommandsCached({ cwd: '/tmp' }),
    ])

    expect(a).toEqual(b)
    expect(OmpRpcClient).toHaveBeenCalledTimes(1)
  })

  it('does NOT cache an empty result — retries on the next call', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    getAvailableCommands.mockResolvedValueOnce({ success: false, error: 'boom' }) // → []
    const first = await discoverOmpCommandsCached({ cwd: '/tmp' })
    expect(first).toEqual([])

    getAvailableCommands.mockResolvedValueOnce({
      success: true, data: { commands: [{ name: 'context', description: 'c', source: 'builtin' }] },
    })
    const second = await discoverOmpCommandsCached({ cwd: '/tmp' })
    expect(second).toEqual([{ name: 'context', description: 'c', source: 'builtin' }])
    expect(OmpRpcClient).toHaveBeenCalledTimes(2) // empty result was not cached
  })

  it('caches per cwd+model key (different cwd re-spawns)', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    getAvailableCommands.mockResolvedValue({
      success: true, data: { commands: [{ name: 'context', description: 'c', source: 'builtin' }] },
    })
    await discoverOmpCommandsCached({ cwd: '/tmp/a' })
    await discoverOmpCommandsCached({ cwd: '/tmp/b' })
    expect(OmpRpcClient).toHaveBeenCalledTimes(2)
  })

  it('clearOmpCommandsCache forces a re-spawn', async () => {
    findOmpBinary.mockReturnValue('/fake/omp')
    getAvailableCommands.mockResolvedValue({
      success: true, data: { commands: [{ name: 'context', description: 'c', source: 'builtin' }] },
    })
    await discoverOmpCommandsCached({ cwd: '/tmp' })
    clearOmpCommandsCache()
    await discoverOmpCommandsCached({ cwd: '/tmp' })
    expect(OmpRpcClient).toHaveBeenCalledTimes(2)
  })
})
