/**
 * Pure energy-based Voice Activity Detection state machine.
 *
 * Feed it (rms, timestampMs) once per audio block; it returns the boundary event that block
 * triggered, if any. It owns NO Web Audio, NO timers, NO PCM — time is driven entirely by the
 * caller's timestamp argument, which makes it fully deterministic and unit-testable (a test can
 * simulate "900 ms of silence" without waiting). The impure engine (mic, ScriptProcessor, PCM
 * accumulation) stays a thin shell around this core.
 *
 * State: LISTENING → (sustained energy) → SPEAKING → (sustained silence) → LISTENING.
 * Onset is debounced by `onsetBlocks` consecutive loud blocks so a single click can't start an
 * utterance; end-of-utterance fires after `silenceDurationMs` of trailing silence. The reported
 * span [startedAt, endedAt] covers actual speech (trailing silence excluded) and is what the gate
 * correlates against wake-word events.
 */

export interface VadConfig {
  /** RMS at or above this counts as voice; below counts as silence. */
  silenceThreshold: number
  /** Trailing silence (ms) after the last voiced block that marks end-of-utterance. */
  silenceDurationMs: number
  /** Utterances whose voiced span is shorter than this (ms) are flagged tooShort (coughs/clicks). */
  minUtteranceMs: number
  /** Consecutive at/above-threshold blocks required to confirm onset (debounce). */
  onsetBlocks: number
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  silenceThreshold: 0.012,
  silenceDurationMs: 900,
  minUtteranceMs: 400,
  onsetBlocks: 3,
}

export type VadEvent =
  | { type: 'speech-start'; startedAt: number }
  | {
      type: 'speech-end'
      startedAt: number
      /** Timestamp of the last voiced block (trailing silence excluded). */
      endedAt: number
      durationMs: number
      /** True when durationMs < minUtteranceMs — caller should discard. */
      tooShort: boolean
    }

export interface VadStateMachine {
  /** Process one audio block. Returns the boundary event it triggered, or null. */
  push(rms: number, timestampMs: number): VadEvent | null
  /** Force back to LISTENING and drop any in-progress utterance (no event emitted). */
  reset(): void
  /** Current coarse phase, for UI. */
  phase(): 'listening' | 'speaking'
}

export function createVadStateMachine(config: VadConfig): VadStateMachine {
  let speaking = false
  // While listening: run of consecutive loud blocks + when that run began.
  let onsetCount = 0
  let onsetStartedAt = 0
  // While speaking: when speech began and when the last voiced block occurred.
  let speechStartedAt = 0
  let lastVoiceAt = 0

  function reset(): void {
    speaking = false
    onsetCount = 0
    onsetStartedAt = 0
    speechStartedAt = 0
    lastVoiceAt = 0
  }

  function push(rms: number, t: number): VadEvent | null {
    const loud = rms >= config.silenceThreshold

    if (!speaking) {
      if (loud) {
        if (onsetCount === 0) onsetStartedAt = t
        onsetCount += 1
        if (onsetCount >= config.onsetBlocks) {
          speaking = true
          speechStartedAt = onsetStartedAt
          lastVoiceAt = t
          onsetCount = 0
          return { type: 'speech-start', startedAt: speechStartedAt }
        }
      } else {
        // Silence breaks the onset run.
        onsetCount = 0
      }
      return null
    }

    // speaking
    if (loud) {
      lastVoiceAt = t
      return null
    }
    if (t - lastVoiceAt >= config.silenceDurationMs) {
      const startedAt = speechStartedAt
      const endedAt = lastVoiceAt
      const durationMs = endedAt - startedAt
      reset()
      return {
        type: 'speech-end',
        startedAt,
        endedAt,
        durationMs,
        tooShort: durationMs < config.minUtteranceMs,
      }
    }
    return null
  }

  return { push, reset, phase: () => (speaking ? 'speaking' : 'listening') }
}
