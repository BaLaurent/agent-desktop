import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockAgent } from '../__tests__/setup'
import { useSettingsStore } from './settingsStore'

// Mock encodeWav/decodeToMono16k — must be before store import (ES module hoisting)
vi.mock('../utils/wavEncoder', () => ({
  encodeWav: vi.fn().mockReturnValue(new ArrayBuffer(100)),
  decodeToMono16k: vi.fn().mockReturnValue(new Float32Array([0.1, 0.2])),
}))

// Mock the Parakeet worker facade so the STT-backend branch is exercised without ORT.
const parakeetMock = vi.hoisted(() => ({
  isParakeetLoaded: vi.fn(() => true),
  loadParakeet: vi.fn().mockResolvedValue(undefined),
  transcribeParakeet: vi.fn().mockResolvedValue('bonjour le monde'),
}))
vi.mock('../services/parakeet', () => parakeetMock)

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

// jsdom (v28) doesn't implement Blob.arrayBuffer; decodeAudioData is mocked so the
// bytes are irrelevant — just hand the store a buffer so the decode path runs.
Blob.prototype.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8)) as typeof Blob.prototype.arrayBuffer

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

  describe('Parakeet backend', () => {
    beforeEach(() => {
      useSettingsStore.setState({
        settings: { stt_backend: 'parakeet', parakeet_modelSource: 'download', parakeet_backend: 'auto' },
      })
      parakeetMock.isParakeetLoaded.mockReturnValue(true)
      parakeetMock.loadParakeet.mockResolvedValue(undefined)
      parakeetMock.transcribeParakeet.mockResolvedValue('bonjour le monde')
    })
    afterEach(() => {
      useSettingsStore.setState({ settings: {} })
    })

    it('skips Whisper validation and opens the mic directly', async () => {
      await useVoiceInputStore.getState().startRecording()
      expect(mockAgent.whisper.validateConfig).not.toHaveBeenCalled()
      expect(useVoiceInputStore.getState().isRecording).toBe(true)
    })

    it('transcribes through the Parakeet worker, not Whisper IPC', async () => {
      await useVoiceInputStore.getState().startRecording()
      mockRecorderInstance!.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) })
      await useVoiceInputStore.getState().stopAndTranscribe()

      expect(parakeetMock.transcribeParakeet).toHaveBeenCalled()
      expect(mockAgent.whisper.transcribe).not.toHaveBeenCalled()
      expect(useVoiceInputStore.getState().lastTranscription?.text).toBe('bonjour le monde')
    })

    it('loads the model first when not yet resident', async () => {
      parakeetMock.isParakeetLoaded.mockReturnValue(false)
      await useVoiceInputStore.getState().startRecording()
      mockRecorderInstance!.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) })
      await useVoiceInputStore.getState().stopAndTranscribe()

      expect(parakeetMock.loadParakeet).toHaveBeenCalledWith(
        { source: 'download', backend: 'auto', decoderQuant: 'int8', cpuThreads: undefined },
        expect.any(Function),
      )
      expect(useVoiceInputStore.getState().lastTranscription?.text).toBe('bonjour le monde')
    })
  })
})
