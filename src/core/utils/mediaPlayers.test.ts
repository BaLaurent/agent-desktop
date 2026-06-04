import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('./env', () => ({
  findBinaryInPath: vi.fn(),
}))

import { execFile } from 'child_process'
import { findBinaryInPath } from './env'
import { pauseMediaPlayers, resumeMediaPlayers, _resetForTesting } from './mediaPlayers'

function mockPlayerctl(path: string | null) {
  vi.mocked(findBinaryInPath).mockImplementation((n) => (n === 'playerctl' ? path : null))
}

// Returns sequential stdout outputs for each execFile call, ignoring args.
function mockExecSequence(outputs: string[]) {
  let i = 0
  vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb: any) => {
    cb(null, outputs[i++] ?? '', '')
    return {} as any
  })
}

// Routes execFile by args: returns an Error to simulate failure.
function mockExecRouter(handler: (args: string[]) => string | Error) {
  vi.mocked(execFile).mockImplementation((_bin, args: any, _opts, cb: any) => {
    const result = handler(args as string[])
    if (result instanceof Error) cb(result, '', '')
    else cb(null, result, '')
    return {} as any
  })
}

describe('mediaPlayers', () => {
  beforeEach(() => {
    _resetForTesting()
    vi.clearAllMocks()
  })

  it('pauses only players in Playing status', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence([
      'spotify\nfirefox\nvlc', // --list-all
      'Playing',               // spotify status
      '',                      // spotify pause
      'Paused',                // firefox status
      'Playing',               // vlc status
      '',                      // vlc pause
    ])

    await pauseMediaPlayers()

    const calls = vi.mocked(execFile).mock.calls.map((c) => c[1])
    expect(calls).toEqual([
      ['--list-all'],
      ['-p', 'spotify', 'status'],
      ['-p', 'spotify', 'pause'],
      ['-p', 'firefox', 'status'],
      ['-p', 'vlc', 'status'],
      ['-p', 'vlc', 'pause'],
    ])
  })

  it('resumes only the players it paused', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence([
      'spotify\nfirefox\nvlc',
      'Playing', '',   // spotify playing → pause
      'Paused',        // firefox paused → skip
      'Playing', '',   // vlc playing → pause
    ])
    await pauseMediaPlayers()

    vi.mocked(execFile).mockClear()
    mockExecSequence(['', '']) // spotify play, vlc play
    await resumeMediaPlayers()

    const calls = vi.mocked(execFile).mock.calls.map((c) => c[1])
    expect(calls).toEqual([
      ['-p', 'spotify', 'play'],
      ['-p', 'vlc', 'play'],
    ])
  })

  it('is idempotent: second pause is a no-op', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence(['spotify', 'Playing', ''])
    await pauseMediaPlayers()
    const countAfterFirst = vi.mocked(execFile).mock.calls.length

    await pauseMediaPlayers()
    expect(vi.mocked(execFile).mock.calls.length).toBe(countAfterFirst)
  })

  it('resume without a prior pause is a no-op', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    await resumeMediaPlayers()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('no-op when playerctl is not installed', async () => {
    mockPlayerctl(null)
    await pauseMediaPlayers()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('does not throw when a player closes before resume', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence(['spotify', 'Playing', ''])
    await pauseMediaPlayers()

    vi.mocked(execFile).mockClear()
    mockExecRouter((args) =>
      args.includes('play') ? new Error('No player could handle this command') : '',
    )
    await expect(resumeMediaPlayers()).resolves.toBeUndefined()
  })

  it('resume awaits an in-flight pause (race protection)', async () => {
    mockPlayerctl('/usr/bin/playerctl')
    mockExecSequence(['spotify', 'Playing', '', '']) // list, status, pause, then play
    const pausing = pauseMediaPlayers() // not awaited
    await resumeMediaPlayers()
    await pausing

    const playCall = vi.mocked(execFile).mock.calls.find((c) => (c[1] as string[]).includes('play'))
    expect(playCall?.[1]).toEqual(['-p', 'spotify', 'play'])
  })
})
