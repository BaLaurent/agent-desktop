import { create } from 'zustand'
import { encodeWav } from '../utils/wavEncoder'

interface VoiceInputState {
  isRecording: boolean
  isTranscribing: boolean
  error: string | null
  lastTranscription: { text: string; id: number } | null
  toggleRecording: () => void
  startRecording: () => void
  stopAndTranscribe: () => void
  cancelRecording: () => void
  clearError: () => void
  clearTranscription: () => void
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

      // Validate whisper config first
      const config = await window.agent.whisper.validateConfig()
      if (!config.modelFound) {
        set({ error: 'Whisper model not found. Configure it in Settings > Voice Input.' })
        return
      }
      if (!config.binaryFound) {
        set({ error: `Whisper binary "${config.binaryPath}" not found. Install whisper.cpp or configure the path in Settings > Voice Input.` })
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStream = stream
      audioChunks = []

      const recorder = new MediaRecorder(stream)
      mediaRecorder = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data)
      }

      recorder.start()
      set({ isRecording: true })
    } catch (err) {
      releaseMediaStream()
      const msg = err instanceof Error ? err.message : 'Failed to start recording'
      if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
        set({ error: 'Microphone access denied. Allow microphone access in your system settings.' })
      } else {
        set({ error: msg })
      }
    }
  },

  stopAndTranscribe: async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      releaseMediaStream()
      set({ isRecording: false })
      return
    }

    set({ isRecording: false, isTranscribing: true, error: null })

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
      const audioCtx = new AudioContext({ sampleRate: 48000 })
      let audioBuffer: AudioBuffer
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      } finally {
        await audioCtx.close()
      }

      const wavBuffer = encodeWav(audioBuffer, 16000)

      // Send to main process for transcription (ArrayBuffer transferred via structured clone)
      const result = await window.agent.whisper.transcribe(new Uint8Array(wavBuffer))

      if (result.text) {
        transcriptionCounter++
        set({
          isTranscribing: false,
          lastTranscription: { text: result.text, id: transcriptionCounter },
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
  },

  clearError: () => set({ error: null }),
  clearTranscription: () => set({ lastTranscription: null }),
}))
