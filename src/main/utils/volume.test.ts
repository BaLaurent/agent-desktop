import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('./env', () => ({
  findBinaryInPath: vi.fn(),
}))

import { execFile } from 'child_process'
import { findBinaryInPath } from './env'
import { duckVolume, restoreVolume, duckOtherStreams, restoreOtherStreams, _resetForTesting } from './volume'

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

describe('stream ducking', () => {
  const PACTL_LIST_TWO_INPUTS = [
    'Sink Input #42',
    '    Driver: protocol-native.c',
    '    Volume: front-left: 52428 /  80% / -5.81 dB',
    '    Properties:',
    '        application.process.binary = "firefox"',
    'Sink Input #99',
    '    Driver: protocol-native.c',
    '    Volume: front-left: 32768 /  50% / -18.06 dB',
    '    Properties:',
    '        application.process.binary = "vlc"',
  ].join('\n')

  beforeEach(() => {
    _resetForTesting()
    vi.clearAllMocks()
  })

  it('ducks two sink inputs by reduction amount', async () => {
    vi.mocked(findBinaryInPath).mockImplementation((n) => (n === 'pactl' ? '/usr/bin/pactl' : null))
    // Call 0: list sink-inputs → two inputs
    // Call 1: set-sink-input-volume #42 → ''
    // Call 2: set-sink-input-volume #99 → ''
    mockExecSequence([PACTL_LIST_TWO_INPUTS, '', ''])

    await duckOtherStreams(30)

    expect(execFile).toHaveBeenCalledTimes(3)
    // list call
    expect(vi.mocked(execFile).mock.calls[0][1]).toEqual(['list', 'sink-inputs'])
    // #42: 80 - 30 = 50
    expect(vi.mocked(execFile).mock.calls[1][1]).toEqual(['set-sink-input-volume', '42', '50%'])
    // #99: 50 - 30 = 20
    expect(vi.mocked(execFile).mock.calls[2][1]).toEqual(['set-sink-input-volume', '99', '20%'])
  })

  it('no-op when pactl not found', async () => {
    vi.mocked(findBinaryInPath).mockReturnValue(null)

    await duckOtherStreams(30)

    expect(execFile).not.toHaveBeenCalled()
  })

  it('no-op when reductionPercent is 0', async () => {
    vi.mocked(findBinaryInPath).mockImplementation((n) => (n === 'pactl' ? '/usr/bin/pactl' : null))

    await duckOtherStreams(0)

    expect(execFile).not.toHaveBeenCalled()
  })

  it('second duck is ignored (double-duck protection)', async () => {
    vi.mocked(findBinaryInPath).mockImplementation((n) => (n === 'pactl' ? '/usr/bin/pactl' : null))
    mockExecSequence([PACTL_LIST_TWO_INPUTS, '', '', PACTL_LIST_TWO_INPUTS, '', ''])

    await duckOtherStreams(30)
    await duckOtherStreams(20) // should be ignored

    // Only 3 calls: list + 2 set from the first duck
    expect(execFile).toHaveBeenCalledTimes(3)
  })

  it('restoreOtherStreams restores saved streams', async () => {
    vi.mocked(findBinaryInPath).mockImplementation((n) => (n === 'pactl' ? '/usr/bin/pactl' : null))
    // duck: list(0) + set(1) + set(2), restore: re-list(3) + set(4) + set(5)
    mockExecSequence([PACTL_LIST_TWO_INPUTS, '', '', PACTL_LIST_TWO_INPUTS, '', ''])

    await duckOtherStreams(30)
    await restoreOtherStreams()

    // 3 from duck + 1 re-list + 2 restore calls
    expect(execFile).toHaveBeenCalledTimes(6)
    // re-list during restore
    expect(vi.mocked(execFile).mock.calls[3][1]).toEqual(['list', 'sink-inputs'])
    // restore #42 to original 80%
    expect(vi.mocked(execFile).mock.calls[4][1]).toEqual(['set-sink-input-volume', '42', '80%'])
    // restore #99 to original 50%
    expect(vi.mocked(execFile).mock.calls[5][1]).toEqual(['set-sink-input-volume', '99', '50%'])
  })

  it('restoreOtherStreams is no-op when not ducked', async () => {
    vi.mocked(findBinaryInPath).mockImplementation((n) => (n === 'pactl' ? '/usr/bin/pactl' : null))

    await restoreOtherStreams()

    expect(execFile).not.toHaveBeenCalled()
  })

  it('restoreOtherStreams matches by app name when stream index changes', async () => {
    vi.mocked(findBinaryInPath).mockImplementation((n) => (n === 'pactl' ? '/usr/bin/pactl' : null))

    const duckList = [
      'Sink Input #42',
      '    Volume: front-left: 52428 /  80% / -5.81 dB',
      '    Properties:',
      '        application.process.binary = "firefox"',
    ].join('\n')

    // Stream died and was recreated with a different index
    const restoreList = [
      'Sink Input #57',
      '    Volume: front-left: 36045 /  55% / -blah',
      '    Properties:',
      '        application.process.binary = "firefox"',
    ].join('\n')

    // duck: list(0) + set(1), restore: re-list(2) + set(3)
    mockExecSequence([duckList, '', restoreList, ''])

    await duckOtherStreams(25)
    await restoreOtherStreams()

    expect(execFile).toHaveBeenCalledTimes(4)
    // Restore: matched by app name to new index #57, original volume 80%
    expect(vi.mocked(execFile).mock.calls[3][1]).toEqual(['set-sink-input-volume', '57', '80%'])
  })

  it('restoreOtherStreams awaits pending duck before restoring', async () => {
    vi.mocked(findBinaryInPath).mockImplementation((n) => (n === 'pactl' ? '/usr/bin/pactl' : null))

    const listOutput = [
      'Sink Input #42',
      '    Volume: front-left: 52428 /  80% / -5.81 dB',
    ].join('\n')

    // duck: list(0) + set(1), restore: re-list(2) + set(3)
    mockExecSequence([listOutput, '', listOutput, ''])

    // Start duck without awaiting (simulates fire-and-forget)
    const duckP = duckOtherStreams(30)
    // Immediately restore — should wait for duck to finish first
    await restoreOtherStreams()
    await duckP

    expect(execFile).toHaveBeenCalledTimes(4)
    expect(vi.mocked(execFile).mock.calls[3][1]).toEqual(['set-sink-input-volume', '42', '80%'])
  })
})

describe('race condition protection', () => {
  beforeEach(() => {
    _resetForTesting()
    vi.clearAllMocks()
  })

  it('restoreVolume awaits pending duckVolume before restoring', async () => {
    mockBackend('wpctl', '/usr/bin/wpctl')
    mockExecSequence(['Volume: 0.80', '', ''])

    // Start duck without awaiting (simulates quickChat.ts fire-and-forget)
    const duckP = duckVolume(30)
    // Immediately call restore — should wait for duck to finish first
    await restoreVolume()
    await duckP

    // 3 calls: get-volume + set-volume(duck) + set-volume(restore)
    expect(execFile).toHaveBeenCalledTimes(3)
    expect(vi.mocked(execFile).mock.calls[2][1]).toEqual(['set-volume', '@DEFAULT_AUDIO_SINK@', '0.8'])
  })
})
