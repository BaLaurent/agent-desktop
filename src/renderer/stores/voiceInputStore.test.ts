import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockAgent } from '../__tests__/setup'

// Mock encodeWav — must be before store import (ES module hoisting)
vi.mock('../utils/wavEncoder', () => ({
  encodeWav: vi.fn().mockReturnValue(new ArrayBuffer(100)),
}))

// --- MediaRecorder class mock ---
let mockRecorderInstance: InstanceType<typeof FakeMediaRecorder> | null = null

class FakeMediaRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  static isTypeSupported = vi.fn().mockReturnValue(true)

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    mockRecorderInstance = this
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    setTimeout(() => this.onstop?.(), 0)
  }
}
vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

// --- navigator.mediaDevices.getUserMedia mock ---
const mockTrack = { stop: vi.fn() }
const mockStream = { getTracks: vi.fn().mockReturnValue([mockTrack]) }
Object.defineProperty(navigator, 'mediaDevices', {
  value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
  writable: true,
  configurable: true,
})

// --- AudioContext mock ---
const mockAudioBuffer = {
  length: 16000,
  sampleRate: 16000,
  numberOfChannels: 1,
  getChannelData: vi.fn().mockReturnValue(new Float32Array(16000)),
  duration: 1,
}
const mockAudioCtx = {
  decodeAudioData: vi.fn().mockResolvedValue(mockAudioBuffer),
  close: vi.fn().mockResolvedValue(undefined),
}
vi.stubGlobal(
  'AudioContext',
  class {
    decodeAudioData = mockAudioCtx.decodeAudioData
    close = mockAudioCtx.close
  },
)

// Now import the store (after all mocks are in place)
const { useVoiceInputStore } = await import('./voiceInputStore')

describe('voiceInputStore', () => {
  beforeEach(() => {
    mockRecorderInstance = null
    useVoiceInputStore.setState({
      isRecording: false,
      isTranscribing: false,
      error: null,
      lastTranscription: null,
    })
    // Restore default mock behaviors (setup.ts already clears mockAgent mocks)
    mockAgent.whisper.validateConfig.mockResolvedValue({
      binaryFound: true,
      modelFound: true,
      binaryPath: 'whisper-cli',
      modelPath: '/model.bin',
    })
    mockAgent.whisper.transcribe.mockResolvedValue({ text: '' })
    mockAgent.voice.duck.mockResolvedValue(undefined)
    mockAgent.voice.restore.mockResolvedValue(undefined)
    ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue(mockStream)
  })

  describe('startRecording', () => {
    it('sets error when whisper model not found', async () => {
      mockAgent.whisper.validateConfig.mockResolvedValue({
        binaryFound: true,
        modelFound: false,
        binaryPath: 'whisper-cli',
        modelPath: '/model.bin',
      })

      await useVoiceInputStore.getState().startRecording()

      expect(useVoiceInputStore.getState().error).toContain('Whisper model not found')
      expect(useVoiceInputStore.getState().isRecording).toBe(false)
    })

    it('sets error when whisper binary not found', async () => {
      mockAgent.whisper.validateConfig.mockResolvedValue({
        binaryFound: false,
        modelFound: true,
        binaryPath: '/usr/bin/whisper',
        modelPath: '/model.bin',
      })

      await useVoiceInputStore.getState().startRecording()

      expect(useVoiceInputStore.getState().error).toContain('not found')
      expect(useVoiceInputStore.getState().error).toContain('/usr/bin/whisper')
    })

    it('starts recording and ducks volume on success', async () => {
      await useVoiceInputStore.getState().startRecording()

      expect(useVoiceInputStore.getState().isRecording).toBe(true)
      expect(useVoiceInputStore.getState().error).toBeNull()
      expect(mockAgent.voice.duck).toHaveBeenCalled()
    })

    it('sets error on microphone permission denied', async () => {
      ;(navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Permission denied'),
      )

      await useVoiceInputStore.getState().startRecording()

      expect(useVoiceInputStore.getState().error).toContain('Microphone access denied')
      expect(useVoiceInputStore.getState().isRecording).toBe(false)
    })
  })

  describe('cancelRecording', () => {
    it('resets state and restores volume', () => {
      useVoiceInputStore.setState({ isRecording: true })

      useVoiceInputStore.getState().cancelRecording()

      expect(useVoiceInputStore.getState().isRecording).toBe(false)
      expect(useVoiceInputStore.getState().isTranscribing).toBe(false)
      expect(useVoiceInputStore.getState().error).toBeNull()
      expect(mockAgent.voice.restore).toHaveBeenCalled()
    })
  })

  describe('toggleRecording', () => {
    it('does nothing when transcribing', () => {
      useVoiceInputStore.setState({ isTranscribing: true })
      const startSpy = vi.spyOn(useVoiceInputStore.getState(), 'startRecording')
      const stopSpy = vi.spyOn(useVoiceInputStore.getState(), 'stopAndTranscribe')

      useVoiceInputStore.getState().toggleRecording()

      expect(startSpy).not.toHaveBeenCalled()
      expect(stopSpy).not.toHaveBeenCalled()
    })
  })

  describe('stopAndTranscribe', () => {
    it('restores volume when no active recorder', async () => {
      await useVoiceInputStore.getState().stopAndTranscribe()

      expect(useVoiceInputStore.getState().isRecording).toBe(false)
      expect(mockAgent.voice.restore).toHaveBeenCalled()
    })
  })

  describe('clearError', () => {
    it('clears error state', () => {
      useVoiceInputStore.setState({ error: 'some error' })
      useVoiceInputStore.getState().clearError()
      expect(useVoiceInputStore.getState().error).toBeNull()
    })
  })

  describe('clearTranscription', () => {
    it('clears last transcription', () => {
      useVoiceInputStore.setState({ lastTranscription: { text: 'hello', id: 1 } })
      useVoiceInputStore.getState().clearTranscription()
      expect(useVoiceInputStore.getState().lastTranscription).toBeNull()
    })
  })
})
