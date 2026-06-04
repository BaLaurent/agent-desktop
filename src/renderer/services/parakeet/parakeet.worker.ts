/// <reference lib="webworker" />
/**
 * Parakeet STT inference worker.
 *
 * onnxruntime-web compute is CPU/GPU-heavy (seconds on the 0.6B model) and would
 * jank the renderer's main thread, so it runs here off-thread. The worker owns the
 * loaded ParakeetModel for its window; the main-thread facade (./index.ts) speaks to
 * it over the message protocol below.
 *
 *   ← load { source, backend, wasmPaths, modelKey?, modelBaseUrl? }   → loaded | progress | error
 *   ← transcribe { id, pcm, sampleRate }                              → result | error
 *   ← selftest { wasmPaths, backend }                                 → selftest-result
 */
import * as ort from 'onnxruntime-web'
import { fromHub, fromUrls } from 'parakeet.js'
import type { ParakeetModel } from 'parakeet.js'

const MODEL_KEY = 'parakeet-tdt-0.6b-v3'

// Mirrors parakeet.js' BackendMode (not re-exported from its package entry).
type BackendMode = 'webgpu' | 'webgpu-hybrid' | 'webgpu-strict' | 'wasm'
type BackendPref = 'auto' | 'webgpu' | 'wasm'

type DecoderQuant = 'int8' | 'fp32'

interface LoadMessage {
  type: 'load'
  source: 'download' | 'manual'
  backend: BackendPref
  decoderQuant: DecoderQuant
  cpuThreads?: number
  wasmPaths: string
  modelBaseUrl?: string
}
interface TranscribeMessage {
  type: 'transcribe'
  id: number
  pcm: Float32Array
  sampleRate: number
  /** >0 → window long audio via transcribeLongAudio; 0/undefined → single-pass transcribe. */
  chunkLengthS?: number
}
interface SelftestMessage {
  type: 'selftest'
  wasmPaths: string
  backend: BackendPref
}
type InMessage = LoadMessage | TranscribeMessage | SelftestMessage

let model: ParakeetModel | null = null
let loading: Promise<void> | null = null

/** Resolve the user's backend preference against actual WebGPU availability. */
function resolveBackend(pref: BackendPref): BackendMode {
  if (pref === 'wasm') return 'wasm'
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  if (pref === 'webgpu') return 'webgpu'
  return hasWebGpu ? 'webgpu' : 'wasm' // 'auto'
}

/** `.int8.onnx` for int8, `.onnx` for fp32 — matches the HF repo naming (hub.js). */
function quantSuffix(quant: DecoderQuant): string {
  return quant === 'int8' ? '.int8.onnx' : '.onnx'
}

/**
 * Filenames in the manual model folder. The encoder is forced to fp32 on WebGPU (int8
 * encoder is unsupported there — mirrors hub.js); the decoder follows the user's choice.
 */
function manualFilenames(backend: BackendMode, decoderQuant: DecoderQuant): { encoder: string; decoder: string } {
  const encoder = backend.startsWith('webgpu') ? 'encoder-model.onnx' : 'encoder-model.int8.onnx'
  return { encoder, decoder: `decoder_joint-model${quantSuffix(decoderQuant)}` }
}

async function load(msg: LoadMessage): Promise<void> {
  const backend = resolveBackend(msg.backend)

  // Pin ORT's WASM artifacts to our agent-model: protocol BEFORE parakeet.js initializes
  // the runtime. parakeet.js' initOrt only sets wasmPaths when unset and otherwise falls
  // back to a CDN — setting it here (same ESM singleton) keeps loading offline-capable.
  if (!ort.env.wasm.wasmPaths) ort.env.wasm.wasmPaths = msg.wasmPaths
  const progress = (p: { loaded: number; total: number; file: string }) =>
    self.postMessage({ type: 'progress', loaded: p.loaded, total: p.total, file: p.file })

  if (msg.source === 'manual') {
    const base = msg.modelBaseUrl!.replace(/\/?$/, '/')
    const files = manualFilenames(backend, msg.decoderQuant)
    // The fp32 encoder (WebGPU) exceeds protobuf's 2 GB limit, so its weights ship in a
    // sibling .onnx.data file; the int8 encoder (WASM) is self-contained.
    const encoderDataUrl = backend.startsWith('webgpu') ? base + files.encoder + '.data' : undefined
    model = await fromUrls({
      encoderUrl: base + files.encoder,
      decoderUrl: base + files.decoder,
      tokenizerUrl: base + 'vocab.txt',
      encoderDataUrl,
      filenames: files,
      backend,
      wasmPaths: msg.wasmPaths,
      cpuThreads: msg.cpuThreads,
      preprocessorBackend: 'js',
    })
  } else {
    model = await fromHub(MODEL_KEY, {
      backend,
      decoderQuant: msg.decoderQuant,
      encoderQuant: 'int8', // hub forces fp32 on webgpu automatically
      wasmPaths: msg.wasmPaths,
      cpuThreads: msg.cpuThreads,
      progress,
    })
  }
}

/**
 * Verify the onnxruntime-web WASM runtime loads under the current CSP / wasmPaths,
 * without the ~600 MB model. Feeding ORT non-model bytes still forces it to fetch and
 * instantiate the WASM runtime first: a *deserialize/protobuf* error means the runtime
 * came up cleanly (success); a *fetch/compile/backend* error is a real failure.
 */
async function selftest(msg: SelftestMessage): Promise<void> {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator
    ? !!(await navigator.gpu.requestAdapter().catch(() => null))
    : false
  ort.env.wasm.wasmPaths = msg.wasmPaths
  let ortLoaded = false
  let detail = ''
  try {
    await ort.InferenceSession.create(new Uint8Array([0, 0, 0, 0]))
    ortLoaded = true // creating a session on garbage normally throws; success = runtime fine
  } catch (err) {
    const m = (err instanceof Error ? err.message : String(err)).toLowerCase()
    ortLoaded = /protobuf|deserialize|parse|invalid|model|graph|node/.test(m) && !/wasm|fetch|compile|backend|网络|network/.test(m)
    detail = err instanceof Error ? err.message : String(err)
  }
  self.postMessage({ type: 'selftest-result', ortLoaded, webgpu, backend: resolveBackend(msg.backend), detail })
}

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data
  try {
    if (msg.type === 'selftest') {
      await selftest(msg)
      return
    }
    if (msg.type === 'load') {
      if (!loading) loading = load(msg)
      await loading
      self.postMessage({ type: 'loaded' })
      return
    }
    if (msg.type === 'transcribe') {
      if (loading) await loading
      if (!model) throw new Error('Parakeet model not loaded')
      let text: string
      if (msg.chunkLengthS && msg.chunkLengthS > 0) {
        const result = await model.transcribeLongAudio(msg.pcm, msg.sampleRate, { chunkLengthS: msg.chunkLengthS })
        text = result.text ?? ''
      } else {
        const result = await model.transcribe(msg.pcm, msg.sampleRate)
        text = result.utterance_text ?? ''
      }
      self.postMessage({ type: 'result', id: msg.id, text })
      return
    }
  } catch (err) {
    if (msg.type === 'load') loading = null // allow retry after a failed load
    const message = err instanceof Error ? err.message : String(err)
    const id = msg.type === 'transcribe' ? msg.id : undefined
    self.postMessage({ type: 'error', id, message })
  }
}
