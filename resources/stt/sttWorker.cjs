'use strict'
//
// Node STT sidecar worker for the `deno desktop` shell.
//
// WHY THIS EXISTS: `sherpa-onnx-node` is an N-API native addon. Under `deno desktop`
// it fails to load in-process (`undefined symbol: napi_create_error`, verified in Phase 0).
// So sherpa STT runs HERE, in a plain `node` child process spawned by
// src/desktop/services/sttSidecar.ts, which CAN load the addon. Communication is
// line-delimited JSON over stdio.
//
// SPAWN CONTRACT (see sttSidecar.ts): the parent spawns
//     node <this-file>
// with cwd = repo root (so `require('sherpa-onnx-node')` resolves via node_modules) and,
// on Linux,  LD_LIBRARY_PATH = <repo>/node_modules/sherpa-onnx-linux-x64 : $LD_LIBRARY_PATH
//    macOS,  DYLD_LIBRARY_PATH = <repo>/node_modules/sherpa-onnx-darwin-<arch> : $DYLD_LIBRARY_PATH
//    Windows, PATH           = <repo>\node_modules\sherpa-onnx-win-x64 ; %PATH%
// so the addon's sibling shared libs (libsherpa-onnx-c-api, libonnxruntime, …) load.
//
// PROTOCOL (exactly one JSON object per line):
//   -> request : { "id": <number>, "cacheKey": <string>, "config": <OfflineRecognizerConfig>, "audioPath": <string> }
//   <- response: { "id": <number>, "ok": true,  "text": <string> }
//              | { "id": <number>, "ok": false, "error": <string> }
// stdout carries ONLY response lines; every diagnostic goes to stderr.

const fs = require('fs')
const readline = require('readline')

// Lazy addon load. Capture the failure instead of throwing at startup so the parent gets a
// clean per-request error message rather than an opaque stdin-pipe close.
let sherpa = null
let loadError = null
try {
  sherpa = require('sherpa-onnx-node')
} catch (err) {
  loadError = err instanceof Error ? err.message : String(err)
  process.stderr.write('sttWorker: failed to load sherpa-onnx-node: ' + loadError + '\n')
}

// OfflineRecognizer construction (model load) is expensive; cache it keyed by the parent-supplied
// cacheKey (model path + hotwords signature). A changed model or lexicon busts the cache.
let cached = null // { key: string, recognizer: object }

// Parse a PCM16 WAV (mono or multi-channel) into a Float32Array + sample rate. Mirrors
// src/core/services/sherpaStt.ts::parseWavPcm16 exactly. We parse in JS (never the native
// readWave) so acceptWaveform receives a plain in-heap Float32Array — the proven, buffer-safe
// path (the native readWave hands back an external buffer that some runtimes reject).
function parseWavPcm16(buf) {
  const numChannels = buf.readUInt16LE(22) || 1
  const sampleRate = buf.readUInt32LE(24)
  let offset = 12
  let dataOffset = -1
  let dataLen = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const sz = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      dataOffset = offset + 8
      dataLen = sz
      break
    }
    offset += 8 + sz + (sz & 1)
  }
  if (dataOffset < 0) throw new Error('Invalid WAV: no data chunk')
  const frames = Math.floor(dataLen / 2 / numChannels)
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * numChannels * 2) / 32768
  }
  return { samples, sampleRate }
}

function getRecognizer(cacheKey, config) {
  if (cached && cached.key === cacheKey) return cached.recognizer
  // Native API: OfflineRecognizer is a class (no createOfflineRecognizer factory).
  const recognizer = new sherpa.OfflineRecognizer(config)
  cached = { key: cacheKey, recognizer }
  return recognizer
}

function transcribe(req) {
  if (loadError) {
    throw new Error(
      'sherpa-onnx-node unavailable in the STT sidecar: ' + loadError +
        ' (verify the platform package node_modules/sherpa-onnx-* exists and its dir is on ' +
        'LD_LIBRARY_PATH / DYLD_LIBRARY_PATH / PATH).',
    )
  }
  if (!req || typeof req.audioPath !== 'string' || typeof req.cacheKey !== 'string' || typeof req.config !== 'object' || req.config === null) {
    throw new Error('malformed STT request (need cacheKey, config, audioPath)')
  }
  const recognizer = getRecognizer(req.cacheKey, req.config)
  const buf = fs.readFileSync(req.audioPath)
  const wave = parseWavPcm16(buf)
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
  recognizer.decode(stream)
  const result = recognizer.getResult(stream)
  return (result && result.text ? result.text : '').trim()
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let req
  try {
    req = JSON.parse(trimmed)
  } catch (err) {
    process.stderr.write('sttWorker: unparseable request line: ' + (err instanceof Error ? err.message : String(err)) + '\n')
    return
  }
  const id = typeof req.id === 'number' ? req.id : null
  try {
    const text = transcribe(req)
    send({ id, ok: true, text })
  } catch (err) {
    send({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
rl.on('close', () => process.exit(0))
