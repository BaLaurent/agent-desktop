let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  return audioCtx
}

export function playCompletionSound(): void {
  const ctx = getAudioContext()
  const now = ctx.currentTime

  // First tone: 440Hz for 100ms
  const osc1 = ctx.createOscillator()
  const gain1 = ctx.createGain()
  osc1.frequency.value = 440
  gain1.gain.value = 0.15
  gain1.gain.setValueAtTime(0.15, now)
  gain1.gain.linearRampToValueAtTime(0, now + 0.1)
  osc1.connect(gain1)
  gain1.connect(ctx.destination)
  osc1.start(now)
  osc1.stop(now + 0.1)

  // Second tone: 880Hz for 100ms
  const osc2 = ctx.createOscillator()
  const gain2 = ctx.createGain()
  osc2.frequency.value = 880
  gain2.gain.value = 0.15
  gain2.gain.setValueAtTime(0.15, now + 0.1)
  gain2.gain.linearRampToValueAtTime(0, now + 0.2)
  osc2.connect(gain2)
  gain2.connect(ctx.destination)
  osc2.start(now + 0.1)
  osc2.stop(now + 0.2)
}

export function playErrorSound(): void {
  const ctx = getAudioContext()
  const now = ctx.currentTime

  // Descending tone: 440Hz -> 220Hz over 200ms
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.setValueAtTime(440, now)
  osc.frequency.linearRampToValueAtTime(220, now + 0.2)
  gain.gain.value = 0.15
  gain.gain.setValueAtTime(0.15, now)
  gain.gain.linearRampToValueAtTime(0, now + 0.2)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.2)
}
