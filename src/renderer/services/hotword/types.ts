/**
 * Public types for the hotword detection module.
 *
 * openWakeWord runs a 3-stage ONNX pipeline in a Web Worker:
 *   1. melspectrogram.onnx  — raw 16 kHz PCM → mel spectrogram frames
 *   2. embedding_model.onnx — mel frames window → embedding vector
 *   3. <wakeword>.onnx      — embedding window → score in [0,1]
 *
 * Only the wakeword model is keyword-specific; melspectrogram and embedding
 * are universal across all openWakeWord keywords.
 */

/**
 * onnxruntime-web backend preference.
 * - 'auto'   → use WebGPU if available, fall back to WASM
 * - 'webgpu' → require WebGPU (fails if unavailable at load time)
 * - 'wasm'   → always use WASM
 *
 * NOTE: melspectrogram and embedding models are ALWAYS run on WASM regardless
 * of this setting (they use ops not supported by WebGPU/WebGL backends).
 * Only the wakeword scoring net respects this preference.
 */
export type HotwordBackendPref = 'auto' | 'webgpu' | 'wasm'

export interface HotwordConfig {
  /**
   * 'bundled' — model files are served from /model/hotword/<file>.
   * 'manual'  — the wakeword .onnx is served from /model/hotword-model/<file>;
   *             melspec + embedding always come from /model/hotword/.
   */
  modelSource: 'bundled' | 'manual'

  /**
   * Wakeword identifier.
   * Bundled example: 'hey_jarvis'  → expects /model/hotword/hey_jarvis.onnx
   * Manual example:  'my_keyword'  → expects /model/hotword-model/my_keyword.onnx
   */
  model: string

  /**
   * Only meaningful in 'manual' mode. Provided for forwards compatibility —
   * the uiServer serves /model/hotword-model/ unconditionally in
   * manual mode, so this field is informational only for now.
   */
  modelPath?: string

  /**
   * Score threshold for wake-word fire. Score is in [0,1]; default 0.5.
   * Higher → fewer false positives; lower → fewer missed detections.
   */
  threshold: number

  /**
   * Backend preference for the wakeword scoring net (stage 3 only).
   * See HotwordBackendPref above.
   */
  backend: HotwordBackendPref
}

/**
 * Live hotword detector handle returned by createHotword().
 */
export interface Hotword {
  /**
   * Feed a chunk of mono PCM at the given sample rate.
   * The module resamples to 16 kHz internally using linear interpolation,
   * accumulates samples into 1280-sample (80 ms @16 kHz) windows, and
   * continuously runs the 3-stage pipeline in the worker.
   *
   * @param pcm        Mono Float32 samples in the range [-1, 1].
   * @param sampleRate Sample rate of `pcm` (typically 44100 or 48000 Hz).
   */
  feed(pcm: Float32Array, sampleRate: number): void

  /**
   * Terminate the worker and release all resources.
   * The Hotword instance is unusable after this call.
   */
  stop(): void
}
