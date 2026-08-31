// Continuous-voice segmentation core for the bridge.
//
// The bridge owns a pw-record child and feeds raw s16 mono 16 kHz PCM into this
// helper. It does the work the renderer engine does over a ScriptProcessor:
//   * chunk the byte stream into fixed 512-sample blocks,
//   * compute RMS per block (samples normalized to [-1, 1]),
//   * drive the shared VAD state machine,
//   * keep a pre-roll ring buffer so the first phoneme isn't clipped,
//   * on speech-end emit a base64 WAV containing the pre-roll + voiced span,
//   * honour tooShort by silently dropping the utterance,
//   * honour pause by dropping blocks and resetting the in-progress utterance.
//
// Extracted from bridge.mjs so tests can drive it against synthesized PCM
// without spawning a recorder, and so the bridge and tests share the same
// segmentation code (the orchestrator MUST NOT duplicate this — see the report).
//
// Clock contract: every VAD timestamp is derived from the SAMPLE COUNT
// (`samplesConsumed / 16000 * 1000`), never from `Date.now()`. That keeps
// segmentation deterministic and therefore testable: a test that feeds a
// 3.2-second tone at 16 kHz will see tMs advance by exactly 3200.
import { createVadStateMachine } from '../../../../src/core/services/vadStateMachine.ts'
import { wavHeader, WAV_SAMPLE_RATE } from './wav.mjs'

export const CV_SAMPLE_RATE = WAV_SAMPLE_RATE
export const CV_BLOCK_SAMPLES = 512
export const CV_BLOCK_BYTES = CV_BLOCK_SAMPLES * 2 // s16 mono = 2 bytes/sample

/** Shared zero-length buffer for "no leftover bytes" — avoids an alloc per chunk. */
const EMPTY_CHUNK = Buffer.alloc(0)

function blockRms(buf) {
  let sum = 0
  const n = buf.length / 2
  for (let i = 0; i + 1 < buf.length; i += 2) {
    // little-endian int16
    const v = buf.readInt16LE(i) / 32768
    sum += v * v
  }
  return Math.sqrt(sum / n)
}

/**
 * Build a continuous-capture segmenter.
 *
 * @param {object} cfg
 * @param {number} cfg.silenceThreshold
 * @param {number} cfg.silenceDurationMs
 * @param {number} cfg.minUtteranceMs
 * @param {number} cfg.onsetBlocks
 * @param {number} cfg.preSpeechPadMs
 * @param {(payload: { b64: string, startedAt: number, endedAt: number }) => void} cfg.onUtterance
 *        Called with a base64-encoded WAV (PCM s16 mono 16 kHz) and the
 *        startedAt/endedAt reported by the shared VAD. tooShort utterances
 *        are NEVER delivered — the cough/click filter is applied here.
 */
export function createCvSegmenter(cfg) {
  const onUtterance = cfg.onUtterance
  if (typeof onUtterance !== 'function') {
    throw new Error('createCvSegmenter requires cfg.onUtterance')
  }
  const vad = createVadStateMachine({
    silenceThreshold: cfg.silenceThreshold,
    silenceDurationMs: cfg.silenceDurationMs,
    minUtteranceMs: cfg.minUtteranceMs,
    onsetBlocks: cfg.onsetBlocks,
  })
  const blockMs = (CV_BLOCK_SAMPLES / CV_SAMPLE_RATE) * 1000
  const preRollBlocks = Math.max(1, Math.ceil(cfg.preSpeechPadMs / blockMs))

  let paused = false
  let samplesConsumed = 0
  let accumulating = false
  /** @type {Buffer[]} */
  let accumulator = []
  /** @type {Buffer[]} */
  const preRoll = []
  // Bytes left over from the previous chunk, carried into the next one. A
  // recorder's stdout chunk is an ARBITRARY length and almost never ends on a
  // 1024-byte block boundary, so without this the tail of every chunk is
  // discarded and the stream re-aligns on each boundary. Measured against a
  // real 6.9 s capture that segments correctly in one piece: fed in 1000-byte
  // chunks it produced ZERO utterances, because every chunk is shorter than
  // one block and so contributed nothing at all. Live that is a continuous
  // capture that listens forever and never hears a thing.
  let carry = EMPTY_CHUNK

  /**
   * Push one stdout chunk (any length) of PCM s16 mono 16 kHz. Returns an
   * array of emitted utterance frames in the order they finalized. Frames are
   * { b64, startedAt, endedAt } with tooShort already filtered out.
   */
  function pushChunk(chunk) {
    /** @type {Array<{ b64: string, startedAt: number, endedAt: number }>} */
    const emitted = []
    const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
    let offset = 0
    while (offset + CV_BLOCK_BYTES <= buf.length) {
      const block = buf.subarray(offset, offset + CV_BLOCK_BYTES)
      offset += CV_BLOCK_BYTES

      const rms = blockRms(block)
      const tMs = (samplesConsumed / CV_SAMPLE_RATE) * 1000
      samplesConsumed += CV_BLOCK_SAMPLES

      if (paused) continue

      const ev = vad.push(rms, tMs)

      if (!accumulating && (!ev || ev.type !== 'speech-start')) {
        // Pre-roll: keep the last `preRollBlocks` blocks while idle so the
        // first phoneme isn't clipped when the onset fires. Skip the push
        // on the speech-start block itself — that block already goes into
        // the accumulator below — otherwise the onset block is duplicated.
        preRoll.push(block)
        while (preRoll.length > preRollBlocks) preRoll.shift()
      } else if (accumulating) {
        accumulator.push(block)
      }

      if (!ev) continue

      if (ev.type === 'speech-start') {
        accumulating = true
        accumulator = [...preRoll, block]
        preRoll.length = 0
        continue
      }

      // speech-end
      const blocks = accumulator
      accumulator = []
      accumulating = false
      if (ev.tooShort) continue // cough/click — discard silently
      if (blocks.length === 0) continue

      const total = blocks.reduce((n, b) => n + b.length, 0)
      const pcm = Buffer.concat(blocks, total)
      const b64 = Buffer.concat([wavHeader(pcm.length), pcm]).toString('base64')
      const frame = { b64, startedAt: ev.startedAt, endedAt: ev.endedAt }
      emitted.push(frame)
      onUtterance(frame)
    }
    // COPY the remainder: `buf` may be the caller's chunk, and a stream is
    // free to reuse that buffer the moment the handler returns.
    carry = offset < buf.length ? Buffer.from(buf.subarray(offset)) : EMPTY_CHUNK
    return emitted
  }

  function pause() {
    paused = true
    // Drop any in-progress utterance so half-duplex TTS suspension can't
    // leave a half-captured utterance behind.
    accumulator = []
    preRoll.length = 0
    accumulating = false
    vad.reset()
  }

  function resume() {
    paused = false
  }

  function reset() {
    paused = false
    samplesConsumed = 0
    accumulator = []
    preRoll.length = 0
    accumulating = false
    // A new capture starts on a block boundary; leftover bytes from the last
    // one would shift every subsequent block by a fraction of a frame.
    carry = EMPTY_CHUNK
    vad.reset()
  }

  function isPaused() {
    return paused
  }

  return { pushChunk, pause, resume, reset, isPaused }
}
