import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('./env', () => ({
  findBinaryInPath: vi.fn(),
}))

import { execFile } from 'child_process'
import { findBinaryInPath } from './env'
import { duckVolume, restoreVolume, _resetForTesting } from './volume'

function mockBackend(name: string, path: string) {
  vi.mocked(findBinaryInPath).mockImplementation((n) => (n === name ? path : null))
}

function mockExecSequence(outputs: string[]) {
  let i = 0
  vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb: any) => {
    cb(null, outputs[i++] || '', '')
    return {} as any
  })
}

describe('volume', () => {
  beforeEach(() => {
    _resetForTesting()
    vi.clearAllMocks()
  })

  describe('duck with wpctl', () => {
    it('reads Volume: 0.80, sets 0.5 for reduction 30', async () => {
      mockBackend('wpctl', '/usr/bin/wpctl')
      mockExecSequence(['Volume: 0.80', ''])

      await duckVolume(30)

      expect(execFile).toHaveBeenCalledTimes(2)
      // getVolume call
      expect(vi.mocked(execFile).mock.calls[0][1]).toEqual(['get-volume', '@DEFAULT_AUDIO_SINK@'])
      // setVolume call: 80 - 30 = 50 → 0.5
      expect(vi.mocked(execFile).mock.calls[1][1]).toEqual(['set-volume', '@DEFAULT_AUDIO_SINK@', '0.5'])
    })
  })

  describe('duck with pactl', () => {
    it('reads 50%, sets 20% for reduction 30', async () => {
      mockBackend('pactl', '/usr/bin/pactl')
      mockExecSequence(['Volume: front-left: 32768 /  50% / -18.06 dB', ''])

      await duckVolume(30)

      expect(execFile).toHaveBeenCalledTimes(2)
      expect(vi.mocked(execFile).mock.calls[0][1]).toEqual(['get-sink-volume', '@DEFAULT_SINK@'])
      expect(vi.mocked(execFile).mock.calls[1][1]).toEqual(['set-sink-volume', '@DEFAULT_SINK@', '20%'])
    })
  })

  describe('duck with amixer', () => {
    it('reads [50%], sets 10% for reduction 40', async () => {
      mockBackend('amixer', '/usr/bin/amixer')
      mockExecSequence(['  Mono: Playback 50 [50%] [on]', ''])

      await duckVolume(40)

      expect(execFile).toHaveBeenCalledTimes(2)
      expect(vi.mocked(execFile).mock.calls[0][1]).toEqual(['get', 'Master'])
      expect(vi.mocked(execFile).mock.calls[1][1]).toEqual(['set', 'Master', '10%'])
    })
  })

  it('no-op when reductionPercent is 0', async () => {
    mockBackend('wpctl', '/usr/bin/wpctl')
    await duckVolume(0)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('no-op when no backend found', async () => {
    vi.mocked(findBinaryInPath).mockReturnValue(null)
    await duckVolume(30)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('clamps to 0 when reduction > current volume', async () => {
    mockBackend('wpctl', '/usr/bin/wpctl')
    mockExecSequence(['Volume: 0.20', ''])

    await duckVolume(50)

    // 20 - 50 → clamped to 0 → set-volume 0
    expect(vi.mocked(execFile).mock.calls[1][1]).toEqual(['set-volume', '@DEFAULT_AUDIO_SINK@', '0'])
  })

  it('restores volume after duck', async () => {
    mockBackend('wpctl', '/usr/bin/wpctl')
    mockExecSequence(['Volume: 0.80', '', ''])

    await duckVolume(30)
    await restoreVolume()

    expect(execFile).toHaveBeenCalledTimes(3)
    // Restore call: set back to 0.8 (original 80%)
    expect(vi.mocked(execFile).mock.calls[2][1]).toEqual(['set-volume', '@DEFAULT_AUDIO_SINK@', '0.8'])
  })

  it('restore is no-op when not ducked', async () => {
    mockBackend('wpctl', '/usr/bin/wpctl')
    await restoreVolume()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('second duck is ignored (double-duck protection)', async () => {
    mockBackend('wpctl', '/usr/bin/wpctl')
    mockExecSequence(['Volume: 0.80', '', 'Volume: 0.50', ''])

    await duckVolume(30)
    await duckVolume(20) // should be ignored

    // Only 2 calls: get + set from the first duck
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  describe('wpctl volume > 100%', () => {
    it('handles overamplified volume correctly', async () => {
      mockBackend('wpctl', '/usr/bin/wpctl')
      mockExecSequence(['Volume: 1.50', ''])

      await duckVolume(30)

      // 150 - 30 = 120 → 1.2
      expect(vi.mocked(execFile).mock.calls[1][1]).toEqual(['set-volume', '@DEFAULT_AUDIO_SINK@', '1.2'])
    })
  })
})
