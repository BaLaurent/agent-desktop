/**
 * Shared STT dispatch: transcribe an AudioBuffer with the active backend.
 *
 * Extracted from voiceInputStore.stopAndTranscribe so push-to-talk (one-shot) and the
 * continuous-voice engine (per-utterance) share one source of truth for backend selection,
 * Parakeet lazy-load, and the WAV-vs-PCM handoff. Whisper config validation stays at the
 * recording entry point (it only needs to run once before opening the mic), so this helper
 * assumes a usable backend and just transcribes.
 */

import { encodeWav, decodeToMono16k } from '../../utils/wavEncoder'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  loadParakeet,
  transcribeParakeet,
  isParakeetLoaded,
  type ParakeetLoadConfig,
  type ParakeetBackendPref,
} from '../parakeet'

/** Coarse progress for the Parakeet first-use model load (no-op for Whisper). */
export interface TranscribeProgress {
  modelLoading: boolean
  /** Download progress in [0, 1], or null when indeterminate / not downloading. */
  modelProgress: number | null
}

/** The active STT backend from the settings store. */
export function getSttBackend(): 'whisper' | 'parakeet' | 'sherpa' {
  const v = useSettingsStore.getState().settings['stt_backend']
  if (v === 'parakeet') return 'parakeet'
  if (v === 'sherpa') return 'sherpa'
  return 'whisper'
}

function getParakeetConfig(): ParakeetLoadConfig {
  const s = useSettingsStore.getState().settings
  const source = s['parakeet_modelSource'] === 'manual' ? 'manual' : 'download'
  const backend = (s['parakeet_backend'] as ParakeetBackendPref) || 'wasm'
  const decoderQuant = s['parakeet_decoderQuant'] === 'fp32' ? 'fp32' : 'int8'
  const cpuThreads = Number(s['parakeet_cpuThreads']) || undefined
  return { source, backend, decoderQuant, cpuThreads }
}

/** Long-audio window length in seconds; 0 = auto-windowing. */
function getParakeetChunkLengthS(): number {
  return Number(useSettingsStore.getState().settings['parakeet_chunkLengthS']) || 0
}

/**
 * Transcribe a decoded AudioBuffer with the active backend. Returns the recognized text
 * (possibly empty). `onProgress` reports the Parakeet first-use model load only.
 */
export async function transcribeAudioBuffer(
  audioBuffer: AudioBuffer,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<string> {
  if (getSttBackend() === 'parakeet') {
    // Lazily load the model into this window's worker on first use. After the initial
    // download it resolves from the IndexedDB cache (fast, no network).
    if (!isParakeetLoaded()) {
      onProgress?.({ modelLoading: true, modelProgress: 0 })
      try {
        await loadParakeet(getParakeetConfig(), (p) => {
          onProgress?.({ modelLoading: true, modelProgress: p.total > 0 ? p.loaded / p.total : null })
        })
      } finally {
        onProgress?.({ modelLoading: false, modelProgress: null })
      }
    }
    // Parakeet's mel preprocessor takes raw Float32 PCM directly — no WAV wrapper.
    const pcm = decodeToMono16k(audioBuffer, 16000)
    return transcribeParakeet(pcm, 16000, getParakeetChunkLengthS())
  }

  if (getSttBackend() === 'sherpa') {
    // sherpa runs in the main process; hand it a 16-bit WAV over IPC (same as whisper).
    const wavBuffer = encodeWav(audioBuffer, 16000)
    const result = await window.agent.sherpa.transcribe(new Uint8Array(wavBuffer))
    return result.text
  }

  // Whisper runs in the main process; hand it a 16-bit WAV over IPC.
  const wavBuffer = encodeWav(audioBuffer, 16000)
  const result = await window.agent.whisper.transcribe(new Uint8Array(wavBuffer))
  return result.text
}
