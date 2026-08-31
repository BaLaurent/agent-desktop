// Tests for omarchy/plugins/agent-desktop/bridge/cvSegmenter.mjs.
//
// The bridge owns a pw-record child and would be expensive to drive from a
// node test, so segmentation lives in a self-contained helper the test can
// load directly. The helper itself uses a `.ts` import for the shared VAD;
// esbuild (the same tool the bridge uses for the runtime bundle) materializes
// a node-loadable ESM copy once at the top of this file.
//
// We drive the segmenter with synthesized s16 mono 16 kHz PCM so assertions
// are about segmentation logic, not about recording. The four cases the test
// MUST prove:
//
//   1. silence -> tone -> silence produces exactly ONE utterance
//   2. a burst shorter than `minUtteranceMs` produces ZERO utterances
//   3. two tones separated by more than `silenceDurationMs` produce TWO utterances
//   4. the segmenter's preRoll actually prepends `preRollBlocks` blocks of
//      audio before the voiced span (the design contract of preSpeechPadMs)
//
// Proven to bite: after the suite passes, edit cvSegmenter.mjs to drop the
// `tooShort` filter, re-run, confirm test #2 fails, then restore.
const assert = require('assert')
const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'bridge', 'cvSegmenter.mjs')

// Materialize a node-loadable ESM bundle for the segmenter.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cvSegmenter-'))
const OUT = path.join(TMP, 'cvSegmenter.bundled.mjs')
execFileSync('npx', [
  '--no', 'esbuild',
  SRC,
  '--bundle', '--platform=node', '--format=esm', '--target=node22',
  `--outfile=${OUT}`,
], { stdio: 'pipe' })

;(async () => {
  const mod = await import('file://' + OUT)
  const { createCvSegmenter } = mod

  // ---- PCM helpers --------------------------------------------------------
  //
  // Critical: silence/tone boundaries MUST land on 512-sample block boundaries
  // (the segmenter's chunking unit). Otherwise a non-aligned boundary leaks
  // tone into the silence block, and tests stop meaning what they say.

  const SAMPLE_RATE = 16000
  const BLOCK_SAMPLES = 512
  const BLOCK_MS = (BLOCK_SAMPLES / SAMPLE_RATE) * 1000 // 32 ms

  function silence(n) { return Buffer.alloc(n * 2) }
  function silenceBlocks(n) { return silence(n * BLOCK_SAMPLES) }

  function tone(n, amplitude = 0.5) {
    const amp = Math.floor(amplitude * 32767)
    const buf = Buffer.alloc(n * 2)
    for (let i = 0; i < n; i++) {
      const v = (i & 1) ? amp : -amp
      buf.writeInt16LE(v, i * 2)
    }
    return buf
  }
  function toneBlocks(n, amplitude = 0.5) { return tone(n * BLOCK_SAMPLES, amplitude) }

  function concat(...chunks) { return Buffer.concat(chunks) }

  /**
   * Run a fresh segmenter over one PCM chunk and return all utterances emitted.
   */
  async function feedAndCapture(pcm, opts = {}) {
    const captured = []
    const segInst = createCvSegmenter({
      silenceThreshold: 0.012,
      silenceDurationMs: 100,
      minUtteranceMs: 80,
      onsetBlocks: 3,
      preSpeechPadMs: 60,
      ...opts,
      onUtterance: (u) => captured.push(u),
    })
    segInst.pushChunk(pcm)
    return captured
  }

  // ---- Tests --------------------------------------------------------------

  // 1. silence -> tone -> silence produces exactly ONE utterance.
  {
    const pcm = concat(silenceBlocks(10), toneBlocks(13), silenceBlocks(16))
    const utterances = await feedAndCapture(pcm)
    assert.strictEqual(utterances.length, 1,
      'silence -> tone -> silence must emit exactly one utterance, got ' + utterances.length)
    const u = utterances[0]
    assert.strictEqual(typeof u.b64, 'string', 'b64 must be a base64 string')
    assert.ok(u.b64.length > 100, 'b64 must carry actual PCM')
    const wav = Buffer.from(u.b64, 'base64')
    assert.strictEqual(wav.slice(0, 4).toString(), 'RIFF', 'b64 must decode to RIFF')
    assert.strictEqual(wav.slice(8, 12).toString(), 'WAVE', 'WAVE marker present')
    const dataLen = wav.readUInt32LE(40)
    assert.ok(dataLen > 0, 'data chunk must be non-empty')
    assert.strictEqual(typeof u.startedAt, 'number', 'startedAt must be a number')
    assert.strictEqual(typeof u.endedAt, 'number', 'endedAt must be a number')
    assert.ok(u.endedAt > u.startedAt, 'endedAt must follow startedAt')
    const voiced = u.endedAt - u.startedAt
    assert.ok(voiced >= 80, `voiced span ${voiced} must be >= minUtteranceMs 80`)
  }

  // 2. a burst shorter than minUtteranceMs produces ZERO utterances.
  {
    // 3 loud blocks (onset) = 96 ms voiced span. With minUtteranceMs=200,
    // this is tooShort and must be dropped.
    const pcm = concat(silenceBlocks(6), toneBlocks(3), silenceBlocks(16))
    const utterances = await feedAndCapture(pcm, { minUtteranceMs: 200 })
    assert.deepStrictEqual(utterances, [],
      'tooShort utterance must be silently dropped, got ' + JSON.stringify(utterances))
  }

  // 3. two tones separated by more than silenceDurationMs produce TWO utterances.
  {
    const pcm = concat(
      silenceBlocks(8),
      toneBlocks(13),
      silenceBlocks(12),
      toneBlocks(13),
      silenceBlocks(16),
    )
    const utterances = await feedAndCapture(pcm)
    assert.strictEqual(utterances.length, 2,
      'two well-separated tones must emit exactly two utterances, got ' + utterances.length)
    assert.ok(utterances[1].startedAt > utterances[0].endedAt,
      'second utterance starts after first ended')
  }

  // 4. pre-roll: the segmenter prepends `preRollBlocks` blocks of recent
  //    audio before the voiced span (the design contract of preSpeechPadMs).
  {
    // Direct verification: decode the b64 and inspect the first 3 blocks
    // of emitted PCM. With 30 SILENCE blocks before the tone, the pre-roll
    // window covers the last 3 blocks before speech-start. Speech-start
    // fires at input block 32 (3 loud blocks 30, 31, 32 with onset=3).
    // preRoll at that moment = [b29, b30, b31] (3 blocks).
    //
    // Block b29 is silence. Therefore the FIRST block of the emitted PCM
    // (which is b29, the first block of preRoll) MUST be silence. And the
    // SECOND block (b30) MUST be loud (it's the first loud block of the
    // input — this is what "prepends audio before the voiced span" means
    // in practice: pre-roll spans back into the onset debounce window).
    const preSpeechPadMs = 96
    const pcm = concat(silenceBlocks(30), toneBlocks(13), silenceBlocks(16))
    const utterances = await feedAndCapture(pcm, { preSpeechPadMs })
    assert.strictEqual(utterances.length, 1, 'one utterance expected')
    const u = utterances[0]
    const wav = Buffer.from(u.b64, 'base64')
    const pcmBytes = wav.subarray(44) // skip 44-byte WAV header
    const preRollBlocks = Math.ceil(preSpeechPadMs / BLOCK_MS)
    assert.ok(pcmBytes.length >= BLOCK_SAMPLES * 2 * preRollBlocks,
      `emitted PCM (${pcmBytes.length} bytes) must include at least preRollBlocks=${preRollBlocks} blocks`)
    // First block: all zeros (silence).
    const firstBlock = pcmBytes.subarray(0, BLOCK_SAMPLES * 2)
    let allZero = true
    for (let i = 0; i + 1 < firstBlock.length; i += 2) {
      if (firstBlock.readInt16LE(i) !== 0) { allZero = false; break }
    }
    assert.ok(allZero,
      'first block of emitted PCM must be silence (pre-roll before tone onset)')
    // The LAST block of the prepended audio is the speech-start block (b32).
    // Verify the prepended span is contiguous with the voiced span by
    // checking that the blocks immediately after the prepended window are
    // loud.
    for (let blk = 1; blk <= 3; blk++) {
      const blockBytes = pcmBytes.subarray(blk * BLOCK_SAMPLES * 2, (blk + 1) * BLOCK_SAMPLES * 2)
      let maxAbs = 0
      for (let i = 0; i + 1 < blockBytes.length; i += 2) {
        const v = Math.abs(blockBytes.readInt16LE(i))
        if (v > maxAbs) maxAbs = v
      }
      assert.ok(maxAbs > 10000,
        `block ${blk} after pre-roll must be loud; maxAbs=${maxAbs}`)
    }
  }

  // 5. SEGMENTATION MUST NOT DEPEND ON CHUNK SIZE.
  //
  // Every test above hands the segmenter one big buffer, which is the one
  // thing a real recorder never does: `pw-record`'s stdout arrives in
  // arbitrary-length chunks that almost never end on a 1024-byte block
  // boundary. `pushChunk` used to consume whole blocks out of the chunk it was
  // given and DISCARD the remainder, re-aligning on the next chunk — so up to
  // a block was thrown away per chunk, and for any chunk SHORTER than one
  // block (1024 bytes) every single byte was thrown away.
  //
  // Measured live before the fix: continuous voice reported "Listening…"
  // indefinitely and never produced one utterance, while `pw-record` was
  // demonstrably running and the same audio segmented correctly when fed in
  // one piece. 1000-byte chunks reproduce it exactly.
  {
    const pcm = concat(silenceBlocks(10), toneBlocks(13), silenceBlocks(16))
    const whole = await feedAndCapture(pcm)
    assert.strictEqual(whole.length, 1, 'baseline: one utterance when fed whole')

    // 1000 is the important one: BELOW the 1024-byte block size, so a
    // remainder-dropping implementation never completes a single block.
    for (const size of [1000, 1023, 1024, 1025, 333, 7, 4096]) {
      const captured = []
      const segInst = createCvSegmenter({
        silenceThreshold: 0.012,
        silenceDurationMs: 100,
        minUtteranceMs: 80,
        onsetBlocks: 3,
        preSpeechPadMs: 60,
        onUtterance: (u) => captured.push(u),
      })
      for (let i = 0; i < pcm.length; i += size) {
        segInst.pushChunk(pcm.subarray(i, Math.min(i + size, pcm.length)))
      }
      assert.strictEqual(captured.length, 1,
        `chunk size ${size} must yield exactly one utterance, got ${captured.length}`)
      assert.strictEqual(captured[0].startedAt, whole[0].startedAt,
        `chunk size ${size} must yield the same startedAt as the whole-buffer feed`)
      assert.strictEqual(captured[0].endedAt, whole[0].endedAt,
        `chunk size ${size} must yield the same endedAt as the whole-buffer feed`)
      assert.strictEqual(captured[0].b64, whole[0].b64,
        `chunk size ${size} must yield byte-identical audio`)
    }
  }

  console.log('test_bridge_vad: ok')
})().catch((err) => {
  console.error('test_bridge_vad: FAIL')
  console.error(err && err.stack || err)
  process.exit(1)
})
