// The WAV framing both capture paths hand to the server.
//
// Push-to-talk (`bridge.mjs`) and continuous capture (`cvSegmenter.mjs`) each
// produce raw s16 mono 16 kHz PCM from the same `pw-record` invocation and both
// send it to the same `whisper:transcribe` / `sherpa:transcribe` channels. The
// header is therefore ONE fact, not two: change the rate or the sample format
// and both paths must change together or the server silently mis-decodes one of
// them. It lived twice for a while; this module is why it does not.
//
// Built from the byte count rather than letting pw-record write it: a
// signal-terminated writer can leave the size fields at zero, and a WAV needs a
// seekable sink, which a raw stdout pipe is not.

export const WAV_SAMPLE_RATE = 16000

/** Canonical 44-byte RIFF/WAVE header for `dataLen` bytes of PCM s16 mono 16 kHz. */
export function wavHeader(dataLen) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + dataLen, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(WAV_SAMPLE_RATE, 24)
  h.writeUInt32LE(WAV_SAMPLE_RATE * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(dataLen, 40)
  return h
}
