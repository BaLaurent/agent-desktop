import { create } from 'zustand'
import { encodeWav, decodeToMono16k } from '../utils/wavEncoder'
import { useSettingsStore } from './settingsStore'
import {
  loadParakeet,
  transcribeParakeet,
  isParakeetLoaded,
  type ParakeetLoadConfig,
  type ParakeetBackendPref,
} from '../services/parakeet'

interface VoiceInputState {
  isRecording: boolean
  isTranscribing: boolean
  /** Parakeet only: the model is downloading/initializing in the worker (first use). */
  modelLoading: boolean
  /** Parakeet model download progress in [0, 1], or null when not downloading. */
  modelProgress: number | null
  error: string | null
  lastTranscription: { text: string; id: number } | null
  toggleRecording: () => void
  startRecording: () => void
  stopAndTranscribe: () => void
  cancelRecording: () => void
  clearError: () => void
  clearTranscription: () => void
}

/** Read the active STT backend from the settings store. */
function getSttBackend(): 'whisper' | 'parakeet' {
  return useSettingsStore.getState().settings['stt_backend'] === 'parakeet' ? 'parakeet' : 'whisper'
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

// Module-level refs (not serializable, kept outside Zustand)
let mediaRecorder: MediaRecorder | null = null
let audioChunks: Blob[] = []
let mediaStream: MediaStream | null = null
let transcriptionCounter = 0

function releaseMediaStream(): void {
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
  mediaRecorder = null
  audioChunks = []
}

export const useVoiceInputStore = create<VoiceInputState>((set, get) => ({
  isRecording: false,
  isTranscribing: false,
  modelLoading: false,
  modelProgress: null,
  error: null,
  lastTranscription: null,

  toggleRecording: () => {
    const { isRecording, isTranscribing } = get()
    if (isTranscribing) return
    if (isRecording) {
      get().stopAndTranscribe()
    } else {
      get().startRecording()
    }
  },

  startRecording: async () => {
    try {
      set({ error: null })

      // Validate the active STT backend before opening the mic. Whisper needs its
      // external binary + model; Parakeet loads its ONNX model lazily at transcription
      // time (from IndexedDB cache or the manual folder), so nothing to check here.
      if (getSttBackend() === 'whisper') {
        const config = await window.agent.whisper.validateConfig()
        if (!config.modelFound) {
          set({ error: 'Whisper model not found. Configure it in Settings > Voice Input.' })
          return
        }
        if (!config.binaryFound) {
          set({ error: `Whisper binary "${config.binaryPath}" not found. Install whisper.cpp or configure the path in Settings > Voice Input.` })
          return
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStream = stream
      audioChunks = []

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      mediaRecorder = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data)
      }

      recorder.start()
      set({ isRecording: true })

      // Duck system volume while recording (same as Quick Voice overlay)
      window.agent.voice.duck().catch(() => {})
    } catch (err) {
      releaseMediaStream()
      const msg = err instanceof Error ? err.message : 'Failed to start recording'
      if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
        const hint = navigator.userAgent.includes('Macintosh')
          ? 'Microphone access denied. Go to System Settings > Privacy & Security > Microphone and enable Agent Desktop.'
          : 'Microphone access denied. Allow microphone access in your system settings.'
        set({ error: hint })
      } else {
        set({ error: msg })
      }
    }
  },

  stopAndTranscribe: async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      releaseMediaStream()
      set({ isRecording: false })
      window.agent.voice.restore().catch(() => {})
      return
    }

    set({ isRecording: false, isTranscribing: true, error: null })

    // Restore volume as soon as recording stops (don't wait for transcription)
    window.agent.voice.restore().catch(() => {})

    try {
      // Stop recording and collect all data
      const blob = await new Promise<Blob>((resolve) => {
        mediaRecorder!.onstop = () => {
          resolve(new Blob(audioChunks, { type: mediaRecorder!.mimeType || 'audio/webm' }))
        }
        mediaRecorder!.stop()
      })

      releaseMediaStream()

      if (blob.size === 0) {
        set({ isTranscribing: false, error: 'No audio recorded' })
        return
      }

      // Decode webm → AudioBuffer → WAV
      const arrayBuffer = await blob.arrayBuffer()
      const audioCtx = new AudioContext()
      let audioBuffer: AudioBuffer
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      } finally {
        await audioCtx.close()
      }

      let text: string
      if (getSttBackend() === 'parakeet') {
        // Lazily load the model into this window's worker on first use. After the
        // initial download it resolves from the IndexedDB cache (fast, no network).
        if (!isParakeetLoaded()) {
          set({ modelLoading: true, modelProgress: 0 })
          try {
            await loadParakeet(getParakeetConfig(), (p) => {
              set({ modelProgress: p.total > 0 ? p.loaded / p.total : null })
            })
          } finally {
            set({ modelLoading: false, modelProgress: null })
          }
        }
        // Parakeet's mel preprocessor takes raw Float32 PCM directly — no WAV wrapper.
        const pcm = decodeToMono16k(audioBuffer, 16000)
        text = await transcribeParakeet(pcm, 16000, getParakeetChunkLengthS())
      } else {
        // Whisper runs in the main process; hand it a 16-bit WAV over IPC.
        const wavBuffer = encodeWav(audioBuffer, 16000)
        const result = await window.agent.whisper.transcribe(new Uint8Array(wavBuffer))
        text = result.text
      }

      if (text) {
        transcriptionCounter++
        set({
          isTranscribing: false,
          lastTranscription: { text, id: transcriptionCounter },
        })
      } else {
        set({ isTranscribing: false, error: 'No speech detected' })
      }
    } catch (err) {
      releaseMediaStream()
      const msg = err instanceof Error ? err.message : 'Transcription failed'
      set({ isTranscribing: false, error: msg })
    }
  },

  cancelRecording: () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }
    releaseMediaStream()
    set({ isRecording: false, isTranscribing: false, error: null })
    window.agent.voice.restore().catch(() => {})
  },

  clearError: () => set({ error: null }),
  clearTranscription: () => set({ lastTranscription: null }),
}))
