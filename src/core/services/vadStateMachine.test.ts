import { describe, it, expect } from 'vitest'
import { createVadStateMachine, DEFAULT_VAD_CONFIG, type VadConfig, type VadEvent } from './vadStateMachine'

const BLOCK_MS = 20
const LOUD = 0.05
const QUIET = 0.001

/** Drive the machine with a sequence of RMS values at fixed 20ms block spacing. */
function run(sm: ReturnType<typeof createVadStateMachine>, rmsSeq: number[], startAt = 0): VadEvent[] {
  const events: VadEvent[] = []
  let t = startAt
  for (const rms of rmsSeq) {
    const e = sm.push(rms, t)
    if (e) events.push(e)
    t += BLOCK_MS
  }
  return events
}

const cfg: VadConfig = { ...DEFAULT_VAD_CONFIG, silenceDurationMs: 100, minUtteranceMs: 80, onsetBlocks: 3 }

describe('createVadStateMachine', () => {
  it('requires onsetBlocks consecutive loud blocks before speech-start', () => {
    const sm = createVadStateMachine(cfg)
    expect(sm.push(LOUD, 0)).toBeNull() // 1
    expect(sm.push(LOUD, 20)).toBeNull() // 2
    const e = sm.push(LOUD, 40) // 3 → confirm
    expect(e).toEqual({ type: 'speech-start', startedAt: 0 })
    expect(sm.phase()).toBe('speaking')
  })

  it('does not start on a brief blip shorter than the onset debounce', () => {
    const sm = createVadStateMachine(cfg)
    const events = run(sm, [LOUD, LOUD, QUIET, QUIET, QUIET])
    expect(events).toEqual([])
    expect(sm.phase()).toBe('listening')
  })

  it('startedAt reflects the first loud block of the confirmed run, not the confirming block', () => {
    const sm = createVadStateMachine(cfg)
    const events = run(sm, [LOUD, LOUD, LOUD]) // onset starts at t=0
    expect(events[0]).toEqual({ type: 'speech-start', startedAt: 0 })
  })

  it('ends the utterance after silenceDurationMs of trailing silence and reports the voiced span', () => {
    const sm = createVadStateMachine(cfg)
    // 3 loud (onset) + 5 loud (sustained) → last voice at t = 20*7 = 140
    // then quiet until t - lastVoiceAt >= 100ms
    const seq = [LOUD, LOUD, LOUD, LOUD, LOUD, LOUD, LOUD, LOUD, QUIET, QUIET, QUIET, QUIET, QUIET, QUIET]
    const events = run(sm, seq)
    const start = events.find((e) => e.type === 'speech-start')
    const end = events.find((e) => e.type === 'speech-end')
    expect(start).toEqual({ type: 'speech-start', startedAt: 0 })
    expect(end?.type).toBe('speech-end')
    if (end?.type === 'speech-end') {
      expect(end.startedAt).toBe(0)
      expect(end.endedAt).toBe(140) // last loud block
      expect(end.durationMs).toBe(140)
      expect(end.tooShort).toBe(false)
    }
    expect(sm.phase()).toBe('listening')
  })

  it('flags a too-short utterance (below minUtteranceMs)', () => {
    const sm = createVadStateMachine(cfg)
    // exactly the onset blocks then immediate silence: voiced span = 40ms < 80ms
    const seq = [LOUD, LOUD, LOUD, QUIET, QUIET, QUIET, QUIET, QUIET, QUIET]
    const events = run(sm, seq)
    const end = events.find((e) => e.type === 'speech-end')
    expect(end?.type).toBe('speech-end')
    if (end?.type === 'speech-end') {
      expect(end.durationMs).toBe(40)
      expect(end.tooShort).toBe(true)
    }
  })

  it('treats a short silence gap inside speech as continuous (does not split)', () => {
    const sm = createVadStateMachine(cfg)
    // one quiet block (20ms < 100ms threshold) between loud runs must not end the utterance
    const seq = [LOUD, LOUD, LOUD, LOUD, QUIET, LOUD, LOUD, LOUD]
    const events = run(sm, seq)
    expect(events.filter((e) => e.type === 'speech-end')).toHaveLength(0)
    expect(sm.phase()).toBe('speaking')
  })

  it('re-arms for a second utterance after the first ends', () => {
    const sm = createVadStateMachine(cfg)
    const first = run(sm, [LOUD, LOUD, LOUD, QUIET, QUIET, QUIET, QUIET, QUIET, QUIET])
    expect(first.some((e) => e.type === 'speech-end')).toBe(true)
    const second = run(sm, [LOUD, LOUD, LOUD], 1000)
    expect(second).toEqual([{ type: 'speech-start', startedAt: 1000 }])
  })

  it('reset() drops an in-progress utterance without emitting', () => {
    const sm = createVadStateMachine(cfg)
    run(sm, [LOUD, LOUD, LOUD])
    expect(sm.phase()).toBe('speaking')
    sm.reset()
    expect(sm.phase()).toBe('listening')
    // a single loud block after reset must not immediately confirm
    expect(sm.push(LOUD, 5000)).toBeNull()
  })
})
