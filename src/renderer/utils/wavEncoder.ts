/**
 * Encode an AudioBuffer as a 16-bit PCM WAV file.
 * Downmixes to mono and resamples to targetSampleRate via linear interpolation.
 */
export function encodeWav(audioBuffer: AudioBuffer, targetSampleRate = 16000): ArrayBuffer {
  // Downmix to mono
  const channels = audioBuffer.numberOfChannels
  const srcLength = audioBuffer.length
  const srcData = new Float32Array(srcLength)

  if (channels === 1) {
    srcData.set(audioBuffer.getChannelData(0))
  } else {
    const left = audioBuffer.getChannelData(0)
    const right = audioBuffer.getChannelData(1)
    for (let i = 0; i < srcLength; i++) {
      srcData[i] = (left[i] + right[i]) / 2
    }
  }

  // Resample via linear interpolation
  const srcRate = audioBuffer.sampleRate
  const ratio = srcRate / targetSampleRate
  const dstLength = Math.round(srcLength / ratio)
  const resampled = new Float32Array(dstLength)

  for (let i = 0; i < dstLength; i++) {
    const srcIdx = i * ratio
    const lo = Math.floor(srcIdx)
    const hi = Math.min(lo + 1, srcLength - 1)
    const frac = srcIdx - lo
    resampled[i] = srcData[lo] * (1 - frac) + srcData[hi] * frac
  }

  // Convert float32 → int16 PCM
  const pcm = new Int16Array(dstLength)
  for (let i = 0; i < dstLength; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }

  // Build WAV file: 44-byte header + PCM data
  const pcmBytes = pcm.length * 2
  const buffer = new ArrayBuffer(44 + pcmBytes)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)           // chunk size
  view.setUint16(20, 1, true)            // PCM format
  view.setUint16(22, 1, true)            // mono
  view.setUint32(24, targetSampleRate, true)
  view.setUint32(28, targetSampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true)            // block align
  view.setUint16(34, 16, true)           // bits per sample

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, pcmBytes, true)

  // Write PCM samples
  const output = new Int16Array(buffer, 44)
  output.set(pcm)

  return buffer
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
