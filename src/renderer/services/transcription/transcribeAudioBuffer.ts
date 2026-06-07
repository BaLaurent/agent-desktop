/**
 * Shared STT dispatch: transcribe an AudioBuffer with the active backend.
 *
 * Extracted from voiceInputStore.stopAndTranscribe so push-to-talk (one-shot) and the
 * continuous-voice engine (per-utterance) share one source of truth for backend selection
 * and the WAV handoff. Whisper config validation stays at the recording entry point (it
 * only needs to run once before opening the mic), so this helper assumes a usable backend
 * and just transcribes.
 */

import { encodeWav } from '../../utils/wavEncoder'
import { useSettingsStore } from '../../stores/settingsStore'

/** Coarse progress hook kept for API compatibility — no-op for Whisper and Sherpa. */
export interface TranscribeProgress {
  modelLoading: boolean
  /** Download progress in [0, 1], or null when indeterminate / not downloading. */
  modelProgress: number | null
}

/** The active STT backend from the settings store. */
export function getSttBackend(): 'whisper' | 'sherpa' {
  return useSettingsStore.getState().settings['stt_backend'] === 'sherpa' ? 'sherpa' : 'whisper'
}

/**
 * Transcribe a decoded AudioBuffer with the active backend. Returns the recognized text
 * (possibly empty). `onProgress` is kept for API compatibility but is never called.
 */
export async function transcribeAudioBuffer(
  audioBuffer: AudioBuffer,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<string> {
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
