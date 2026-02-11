import { describe, it, expect } from 'vitest'
import { encodeWav } from './wavEncoder'

/** Create a mock AudioBuffer with the given samples and sample rate */
function createMockAudioBuffer(
  channels: Float32Array[],
  sampleRate: number
): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    duration: channels[0].length / sampleRate,
    getChannelData: (ch: number) => channels[ch],
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer
}

describe('encodeWav', () => {
  it('returns a valid WAV file with correct RIFF header', () => {
    const mono = new Float32Array([0, 0.5, -0.5, 1.0, -1.0])
    const buf = createMockAudioBuffer([mono], 16000)

    const wav = encodeWav(buf, 16000)
    const view = new DataView(wav)

    // RIFF header
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF')
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe('WAVE')

    // fmt chunk
    expect(String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15))).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM format
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000) // sample rate
    expect(view.getUint16(34, true)).toBe(16) // bits per sample

    // data chunk
    expect(String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39))).toBe('data')
  })

  it('produces correct file size (44-byte header + PCM data)', () => {
    const samples = new Float32Array(100)
    const buf = createMockAudioBuffer([samples], 16000)

    const wav = encodeWav(buf, 16000)
    // 44 header + 100 samples * 2 bytes each = 244
    expect(wav.byteLength).toBe(244)

    const view = new DataView(wav)
    // RIFF size = total - 8
    expect(view.getUint32(4, true)).toBe(236)
    // data chunk size = PCM bytes
    expect(view.getUint32(40, true)).toBe(200)
  })

  it('downmixes stereo to mono by averaging channels', () => {
    const left = new Float32Array([1.0, 0.0])
    const right = new Float32Array([0.0, 1.0])
    const buf = createMockAudioBuffer([left, right], 16000)

    const wav = encodeWav(buf, 16000)
    const pcm = new Int16Array(wav, 44)

    // Average of (1.0 + 0.0) / 2 = 0.5 → 0.5 * 0x7FFF ≈ 16383
    expect(pcm[0]).toBeCloseTo(16383, -1)
    // Average of (0.0 + 1.0) / 2 = 0.5
    expect(pcm[1]).toBeCloseTo(16383, -1)
  })

  it('resamples from 48kHz to 16kHz (3:1 ratio)', () => {
    // 300 samples at 48kHz → 100 samples at 16kHz
    const samples = new Float32Array(300)
    for (let i = 0; i < 300; i++) samples[i] = i / 300
    const buf = createMockAudioBuffer([samples], 48000)

    const wav = encodeWav(buf, 16000)
    const pcm = new Int16Array(wav, 44)

    expect(pcm.length).toBe(100)
  })

  it('clamps values to [-1, 1] range', () => {
    const samples = new Float32Array([2.0, -2.0]) // exceeds range
    const buf = createMockAudioBuffer([samples], 16000)

    const wav = encodeWav(buf, 16000)
    const pcm = new Int16Array(wav, 44)

    expect(pcm[0]).toBe(0x7FFF)  // max positive
    expect(pcm[1]).toBe(-0x8000) // max negative
  })

  it('converts silence (zeros) correctly', () => {
    const samples = new Float32Array(10) // all zeros
    const buf = createMockAudioBuffer([samples], 16000)

    const wav = encodeWav(buf, 16000)
    const pcm = new Int16Array(wav, 44)

    for (let i = 0; i < pcm.length; i++) {
      expect(pcm[i]).toBe(0)
    }
  })

  it('handles single sample', () => {
    const samples = new Float32Array([0.5])
    const buf = createMockAudioBuffer([samples], 16000)

    const wav = encodeWav(buf, 16000)
    expect(wav.byteLength).toBe(46) // 44 header + 1 sample * 2 bytes
  })

  it('byte rate equals sampleRate * 2 (mono 16-bit)', () => {
    const samples = new Float32Array(10)
    const buf = createMockAudioBuffer([samples], 16000)

    const wav = encodeWav(buf, 16000)
    const view = new DataView(wav)

    expect(view.getUint32(28, true)).toBe(32000) // 16000 * 2
    expect(view.getUint16(32, true)).toBe(2) // block align
  })
})
