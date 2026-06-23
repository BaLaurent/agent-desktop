/**
 * Single source of truth for sherpa-onnx STT presets and tuning constants.
 *
 * Pure data — no electron/node imports — so it is read by both the renderer (settings UI)
 * and the main process (download handler + hotword scoring).
 *
 * To add or fix a model preset, edit ONLY the SHERPA_MODEL_PRESETS array. Files are fetched
 * from https://huggingface.co/<repo>/resolve/main/<file> into ~/.agent-desktop/stt-models/<id>/.
 * Architecture is auto-detected from the downloaded filenames (see detectArchitecture).
 */

/**
 * Acceptable bounds for a custom lexicon "Boost score" (sherpa hotwords-score). Shared so the
 * settings input (min/max) and the resolver's defensive clamp stay in lock-step.
 * - Below ~0.5 the bias is negligible; use a preset instead.
 * - Above ~10 lexicon words start surfacing even when not spoken (false insertions).
 */
export const BOOST_SCORE_MIN = 0.5
export const BOOST_SCORE_MAX = 10
export interface SherpaModelPreset {
  /** Target folder name under ~/.agent-desktop/stt-models/. */
  id: string
  label: string
  description: string
  /** HuggingFace repo id, e.g. "csukuangfj/sherpa-onnx-...". */
  repo: string
  /** Files to download (relative paths within the repo). */
  files: string[]
}

export const SHERPA_MODEL_PRESETS: SherpaModelPreset[] = [
  {
    id: 'parakeet-tdt-0.6b-v3-int8',
    label: 'Parakeet TDT 0.6B v3 (multilingual, int8)',
    description:
      "NVIDIA Parakeet transducer in sherpa-onnx format — 25 European languages (incl. French), runs locally via the native addon.",
    repo: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    files: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
  },
]
