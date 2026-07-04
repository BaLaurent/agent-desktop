/**
 * Wake-word detection via the `openwakeword-js` library (Apache-2.0, the JS/TS port linked from the
 * official openWakeWord repo). We previously hand-rolled the 3-stage ONNX pipeline; that reinvented
 * the library and was subtly wrong on audio preprocessing. This wraps the real library behind the
 * same `createHotword(config, onWake)` seam the rest of the feature already uses.
 *
 * The library's Model.predict() owns the whole pipeline (melspectrogram → embedding → classifier,
 * optional Silero VAD) INCLUDING the audio scaling. We just feed it 16 kHz mono Float32 frames (the
 * continuous-voice engine forces a 16 kHz AudioContext) and act on the returned per-model scores.
 *
 * Models + the onnxruntime-web WASM runtime are served over same-origin `/model/` HTTP paths
 * (served by the desktop uiServer; file:// can't fetch() in the packaged app), pinned to ORT 1.24.1.
 */

import { Model } from 'openwakeword-js'
import type { HotwordConfig, Hotword } from './types'

const ORT_WASM_PATHS = '/model/ort/'
/** Universal models (melspec + embedding) and bundled wake words. */
const BUNDLED_BASE = '/model/hotword/'
/** Custom/trained wake word folder (manual mode). */
const MANUAL_BASE = '/model/hotword-model/'

/**
 * Create a wake-word detector. `onWake` is invoked (no args, by contract — the caller stamps the
 * timestamp) on the rising edge of a detection. Feed it audio via the returned handle's `feed`.
 */
export async function createHotword(config: HotwordConfig, onWake: () => void): Promise<Hotword> {
  const wakewordBase = config.modelSource === 'manual' ? MANUAL_BASE : BUNDLED_BASE
  const threshold = config.threshold > 0 ? config.threshold : 0.5

  const model = new Model({
    melspectrogramModelPath: BUNDLED_BASE + 'melspectrogram.onnx',
    embeddingModelPath: BUNDLED_BASE + 'embedding_model.onnx',
    wakewordModels: [wakewordBase + config.model + '.onnx'],
    vadThreshold: 0, // no Silero VAD model bundled — disable the library's VAD gate
    inferenceFramework: 'onnx',
    wasmPaths: ORT_WASM_PATHS,
  })
  await model.init()

  let armed = true // rising-edge latch: fire once per crossing above threshold
  let stopped = false
  let draining = false
  const pending: Float32Array[] = []

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (pending.length && !stopped) {
        const audio = pending.shift()!
        const scores = await model.predict(audio)
        let max = 0
        for (const v of Object.values(scores)) if (v > max) max = v
        if (max >= threshold) {
          if (armed) {
            armed = false
            onWake()
          }
        } else {
          armed = true
        }
      }
    } finally {
      draining = false
    }
  }

  return {
    feed(pcm: Float32Array): void {
      // The engine emits 16 kHz mono (forced AudioContext); predict() expects 16 kHz Float32.
      if (stopped) return
      pending.push(pcm)
      void drain()
    },
    stop(): void {
      stopped = true
      pending.length = 0
      model.reset()
    },
  }
}

export type { HotwordConfig, Hotword, HotwordBackendPref } from './types'
