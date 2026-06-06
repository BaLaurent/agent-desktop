/**
 * Single source of truth for downloadable sherpa-onnx STT models.
 *
 * To add or fix a preset, edit ONLY this array. Read by both the renderer (settings UI list)
 * and the main process (download handler). Pure data — no electron/node imports.
 *
 * Files are fetched from https://huggingface.co/<repo>/resolve/main/<file> into
 * ~/.agent-desktop/stt-models/<id>/. Architecture is auto-detected from the downloaded
 * filenames (see detectArchitecture), so any valid sherpa layout works.
 */
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
