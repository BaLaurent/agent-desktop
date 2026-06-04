/**
 * Main-thread facade over the Parakeet STT inference worker.
 *
 * The 0.6B model and onnxruntime-web run in a dedicated Web Worker (./parakeet.worker)
 * so transcription never blocks the UI. This module owns a single worker per window,
 * lazily created, and turns its message protocol into promises. onnxruntime-web's WASM
 * runtime and (in manual mode) the model files are fetched over the agent-model:
 * protocol — file:// can't be fetch()ed in the packaged app.
 */

/** onnxruntime-web/dist served by the main process (see main/services/parakeetProtocol). */
const ORT_WASM_PATHS = 'agent-model://ort/'
/** User's local model folder in manual mode, served by the same protocol. */
const MODEL_BASE_URL = 'agent-model://model/'

export type ParakeetBackendPref = 'auto' | 'webgpu' | 'wasm'
export type ParakeetDecoderQuant = 'int8' | 'fp32'

export interface ParakeetLoadConfig {
  source: 'download' | 'manual'
  backend: ParakeetBackendPref
  decoderQuant: ParakeetDecoderQuant
  /** WASM thread count; omit/0 → auto (navigator.hardwareConcurrency). */
  cpuThreads?: number
}

export interface ParakeetProgress {
  loaded: number
  total: number
  file: string
}

export interface ParakeetSelftestResult {
  ortLoaded: boolean
  webgpu: boolean
  backend: 'webgpu' | 'wasm'
  detail: string
}

let worker: Worker | null = null
let loadState: 'idle' | 'loading' | 'loaded' = 'idle'
let loadPromise: Promise<void> | null = null

let progressCb: ((p: ParakeetProgress) => void) | null = null
let loadResolvers: { resolve: () => void; reject: (e: Error) => void } | null = null
let selftestResolvers: { resolve: (r: ParakeetSelftestResult) => void } | null = null
let transcribeSeq = 0
const pendingTranscribe = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./parakeet.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data
    switch (msg?.type) {
      case 'progress':
        progressCb?.({ loaded: msg.loaded, total: msg.total, file: msg.file })
        break
      case 'loaded':
        loadState = 'loaded'
        loadResolvers?.resolve()
        loadResolvers = null
        break
      case 'selftest-result':
        selftestResolvers?.resolve({
          ortLoaded: msg.ortLoaded,
          webgpu: msg.webgpu,
          backend: msg.backend,
          detail: msg.detail,
        })
        selftestResolvers = null
        break
      case 'result': {
        const p = pendingTranscribe.get(msg.id)
        if (p) {
          pendingTranscribe.delete(msg.id)
          p.resolve(msg.text)
        }
        break
      }
      case 'error': {
        const err = new Error(msg.message || 'Parakeet worker error')
        if (typeof msg.id === 'number') {
          const p = pendingTranscribe.get(msg.id)
          if (p) {
            pendingTranscribe.delete(msg.id)
            p.reject(err)
          }
        } else if (loadResolvers) {
          loadState = 'idle'
          loadPromise = null
          loadResolvers.reject(err)
          loadResolvers = null
        }
        break
      }
    }
  }
  return worker
}

/** Whether the model is already resident in this window's worker. */
export function isParakeetLoaded(): boolean {
  return loadState === 'loaded'
}

/**
 * Load the Parakeet model into the worker (idempotent; concurrent callers share one
 * load). `onProgress` reports per-file download progress in download mode.
 */
export function loadParakeet(config: ParakeetLoadConfig, onProgress?: (p: ParakeetProgress) => void): Promise<void> {
  if (loadState === 'loaded') return Promise.resolve()
  if (loadPromise) return loadPromise

  progressCb = onProgress ?? null
  loadState = 'loading'
  loadPromise = new Promise<void>((resolve, reject) => {
    loadResolvers = { resolve, reject }
    getWorker().postMessage({
      type: 'load',
      source: config.source,
      backend: config.backend,
      decoderQuant: config.decoderQuant,
      cpuThreads: config.cpuThreads,
      wasmPaths: ORT_WASM_PATHS,
      modelBaseUrl: config.source === 'manual' ? MODEL_BASE_URL : undefined,
    })
  })
  return loadPromise
}

/**
 * Transcribe mono 16 kHz Float32 PCM. The model must be loaded first. `chunkLengthS > 0`
 * windows long audio via transcribeLongAudio; 0/undefined does a single-pass transcribe.
 */
export function transcribeParakeet(pcm: Float32Array, sampleRate = 16000, chunkLengthS = 0): Promise<string> {
  const id = ++transcribeSeq
  return new Promise<string>((resolve, reject) => {
    pendingTranscribe.set(id, { resolve, reject })
    // Transfer the PCM buffer to avoid a copy; the renderer no longer needs it.
    getWorker().postMessage({ type: 'transcribe', id, pcm, sampleRate, chunkLengthS }, [pcm.buffer])
  })
}

/**
 * Tear down the worker and reset load state. Call when a load-time setting (decoder
 * precision, thread count) changes so the next transcription reloads with the new config.
 */
export function resetParakeet(): void {
  worker?.terminate()
  worker = null
  loadState = 'idle'
  loadPromise = null
  loadResolvers = null
  pendingTranscribe.clear()
}

/**
 * Verify the onnxruntime-web WASM runtime initializes under the current CSP/wasmPaths,
 * without downloading the model. Backs the Settings "test engine" diagnostic.
 */
export function selftestParakeet(backend: ParakeetBackendPref): Promise<ParakeetSelftestResult> {
  return new Promise<ParakeetSelftestResult>((resolve) => {
    selftestResolvers = { resolve }
    getWorker().postMessage({ type: 'selftest', wasmPaths: ORT_WASM_PATHS, backend })
  })
}
