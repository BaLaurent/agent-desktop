/**
 * Continuous-voice capture engine: live mic → energy VAD → per-utterance transcription.
 *
 * Receives a MediaStream from the orchestrator (which owns getUserMedia + track teardown so the
 * stream can be shared with the hotword detector). Taps it with a ScriptProcessorNode, runs the pure
 * `vadStateMachine` per block, accumulates Float32 PCM during speech (with a pre-roll ring buffer so
 * the onset isn't clipped), and on end-of-utterance hands a rebuilt AudioBuffer to the shared
 * `transcribeAudioBuffer` helper — identical backend dispatch to push-to-talk.
 *
 * Clock contract: every VAD timestamp uses `performance.now()` on the main thread, the SAME clock the
 * orchestrator stamps wake events with — so the gate's wake↔utterance correlation window is valid.
 */

import { createVadStateMachine } from './vadStateMachine'
import { transcribeAudioBuffer } from '../transcription/transcribeAudioBuffer'
import type { EngineConfig } from './config'

export type ContinuousPhase = 'idle' | 'listening' | 'speaking' | 'transcribing' | 'error'

export interface EngineUtterance {
  text: string
  startedAt: number
  endedAt: number
}

export interface ContinuousVoiceCallbacks {
  /** A finalized, transcribed utterance (non-empty text). */
  onUtterance: (u: EngineUtterance) => void
  onPhaseChange?: (phase: ContinuousPhase) => void
  /** High-frequency level meter (RMS). Wire to a ref, NOT a store. */
  onLevel?: (rms: number) => void
  /** Raw mono PCM block for the hotword detector (native sample rate). */
  onFrame?: (pcm: Float32Array, sampleRate: number) => void
  onError?: (message: string) => void
}

export interface ContinuousVoiceEngine {
  stop(): void
  /** Pause VAD + hotword feed and drop the in-progress utterance (e.g. while AI TTS plays). */
  suspend(): void
  resume(): void
}

// 512 samples ≈ 32 ms at the forced 16 kHz context — fine VAD granularity without excess callbacks.
const BLOCK_SIZE = 512

function computeRms(block: Float32Array): number {
  let sum = 0
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
  return Math.sqrt(sum / block.length)
}

/**
 * Start the engine on an already-acquired stream. Returns a handle; call stop() to release the
 * Web Audio graph (the caller still owns and must stop the MediaStream tracks).
 */
export function startContinuousVoiceEngine(
  stream: MediaStream,
  cfg: EngineConfig,
  cb: ContinuousVoiceCallbacks,
): ContinuousVoiceEngine {
  // Force a 16 kHz context so the browser does high-quality (anti-aliased) resampling of the mic.
  // The hotword detector then receives clean 16 kHz frames — a naive linear downsample in the worker
  // aliases 8–24 kHz content into band and corrupts the melspectrogram. Falls back to the default
  // rate if a browser rejects the request (the worker still resamples in that case).
  let audioCtx: AudioContext
  try {
    audioCtx = new AudioContext({ sampleRate: 16000 })
  } catch {
    audioCtx = new AudioContext()
  }
  const source = audioCtx.createMediaStreamSource(stream)
  const processor = audioCtx.createScriptProcessor(BLOCK_SIZE, 1, 1)
  const vad = createVadStateMachine(cfg.vad)

  const blockMs = (BLOCK_SIZE / audioCtx.sampleRate) * 1000
  const preRollBlocks = Math.ceil(cfg.preSpeechPadMs / blockMs)

  let generation = 0
  let suspended = false
  let accumulating = false
  let phase: ContinuousPhase = 'listening'
  const preRoll: Float32Array[] = []
  let accumulator: Float32Array[] = []

  function setPhase(p: ContinuousPhase): void {
    if (phase !== p) {
      phase = p
      cb.onPhaseChange?.(p)
    }
  }

  function finalizeUtterance(startedAt: number, endedAt: number): void {
    const blocks = accumulator
    accumulator = []
    accumulating = false
    if (blocks.length === 0) return

    let total = 0
    for (const b of blocks) total += b.length
    const merged = new Float32Array(total)
    let off = 0
    for (const b of blocks) {
      merged.set(b, off)
      off += b.length
    }
    const buf = audioCtx.createBuffer(1, merged.length, audioCtx.sampleRate)
    buf.copyToChannel(merged, 0)

    const myGen = generation
    setPhase('transcribing')
    transcribeAudioBuffer(buf)
      .then((text) => {
        if (myGen !== generation) return // stale (engine stopped)
        const trimmed = text.trim()
        if (trimmed) cb.onUtterance({ text: trimmed, startedAt, endedAt })
      })
      .catch((err) => {
        if (myGen !== generation) return
        cb.onError?.(err instanceof Error ? err.message : 'Transcription failed')
      })
      .finally(() => {
        if (myGen === generation && phase === 'transcribing') {
          setPhase(vad.phase() === 'speaking' ? 'speaking' : 'listening')
        }
      })
  }

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    if (suspended) return

    const rms = computeRms(input)
    cb.onLevel?.(rms)
    // Copy: the input buffer is reused by the audio thread after this callback.
    const block = input.slice()
    // onFrame's consumer (hotword.feed) TRANSFERS the buffer it receives, neutering it. Hand it a
    // SEPARATE copy so `block` stays intact for the pre-roll/accumulator — otherwise the utterance
    // audio concatenates detached (length-0) buffers and transcription comes out empty.
    cb.onFrame?.(block.slice(), audioCtx.sampleRate)

    // Maintain the pre-roll ring buffer (only needed while not yet accumulating).
    if (!accumulating) {
      preRoll.push(block)
      while (preRoll.length > preRollBlocks) preRoll.shift()
    } else {
      accumulator.push(block)
    }

    const event = vad.push(rms, performance.now())
    if (!event) {
      if (vad.phase() === 'speaking' && phase === 'listening') setPhase('speaking')
      return
    }

    if (event.type === 'speech-start') {
      accumulating = true
      accumulator = [...preRoll, block]
      preRoll.length = 0
      setPhase('speaking')
    } else if (event.tooShort) {
      // cough/click — discard and re-arm
      accumulator = []
      accumulating = false
      setPhase('listening')
    } else {
      finalizeUtterance(event.startedAt, event.endedAt)
    }
  }

  source.connect(processor)
  // Must connect to destination for onaudioprocess to fire; output buffer is never written,
  // so it stays silent (no mic → speaker passthrough / feedback).
  processor.connect(audioCtx.destination)
  setPhase('listening')

  return {
    stop() {
      generation++
      processor.onaudioprocess = null
      try {
        processor.disconnect()
        source.disconnect()
      } catch {
        /* already disconnected */
      }
      void audioCtx.close().catch(() => {})
      accumulator = []
      preRoll.length = 0
      accumulating = false
      setPhase('idle')
    },
    suspend() {
      suspended = true
      vad.reset()
      accumulator = []
      preRoll.length = 0
      accumulating = false
      if (phase === 'speaking') setPhase('listening')
    },
    resume() {
      suspended = false
    },
  }
}
