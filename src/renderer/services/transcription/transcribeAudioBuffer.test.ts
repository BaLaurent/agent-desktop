import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'

// Mock parakeet worker facade — must be before module import (ES module hoisting).
vi.mock('../parakeet', () => ({
  loadParakeet: vi.fn(),
  transcribeParakeet: vi.fn(),
  isParakeetLoaded: vi.fn(() => true),
  resetParakeet: vi.fn(),
  selftestParakeet: vi.fn(),
}))

// Mock wavEncoder utilities — must be before module import.
vi.mock('../../utils/wavEncoder', () => ({
  encodeWav: vi.fn(() => new ArrayBuffer(8)),
  decodeToMono16k: vi.fn(() => new Float32Array(8)),
}))

const fakeAudioBuffer = {
  numberOfChannels: 1,
  sampleRate: 16000,
  length: 8,
  getChannelData: () => new Float32Array(8),
} as unknown as AudioBuffer

describe('transcribeAudioBuffer — sherpa branch', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: { stt_backend: 'sherpa' } as any })
    window.agent = {
      sherpa: { transcribe: vi.fn(async () => ({ text: 'bonjour' })) },
    } as any
  })

  it('returns the text from window.agent.sherpa.transcribe', async () => {
    const { transcribeAudioBuffer } = await import('./transcribeAudioBuffer')
    const result = await transcribeAudioBuffer(fakeAudioBuffer)
    expect(result).toBe('bonjour')
  })

  it('calls window.agent.sherpa.transcribe once with a Uint8Array', async () => {
    const { transcribeAudioBuffer } = await import('./transcribeAudioBuffer')
    await transcribeAudioBuffer(fakeAudioBuffer)
    const transcribeMock = (window.agent as any).sherpa.transcribe as ReturnType<typeof vi.fn>
    expect(transcribeMock).toHaveBeenCalledTimes(1)
    const [arg] = transcribeMock.mock.calls[0]
    expect(arg).toBeInstanceOf(Uint8Array)
  })
})
