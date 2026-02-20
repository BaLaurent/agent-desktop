import { execFile } from 'child_process'
import { findBinaryInPath } from './env'

interface BackendInfo {
  name: 'wpctl' | 'pactl' | 'amixer'
  path: string
}

let cachedBackend: BackendInfo | null | undefined = undefined
let savedVolume: number | null = null

function detectBackend(): BackendInfo | null {
  if (cachedBackend !== undefined) return cachedBackend

  for (const name of ['wpctl', 'pactl', 'amixer'] as const) {
    const p = findBinaryInPath(name)
    if (p) {
      cachedBackend = { name, path: p }
      return cachedBackend
    }
  }
  cachedBackend = null
  return null
}

function exec(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

async function getVolume(backend: BackendInfo): Promise<number> {
  switch (backend.name) {
    case 'wpctl': {
      // "Volume: 0.80" or "Volume: 0.80 [MUTED]"
      const out = await exec(backend.path, ['get-volume', '@DEFAULT_AUDIO_SINK@'])
      const match = out.match(/Volume:\s+(\d+\.?\d*)/)
      if (!match) throw new Error(`wpctl: unexpected output: ${out}`)
      return Math.round(parseFloat(match[1]) * 100)
    }
    case 'pactl': {
      // "Volume: front-left: 52428 /  80% / -5.81 dB,   front-right: ..."
      const out = await exec(backend.path, ['get-sink-volume', '@DEFAULT_SINK@'])
      const match = out.match(/(\d+)%/)
      if (!match) throw new Error(`pactl: unexpected output: ${out}`)
      return parseInt(match[1], 10)
    }
    case 'amixer': {
      // "  Mono: Playback 50 [80%] [on]"
      const out = await exec(backend.path, ['get', 'Master'])
      const match = out.match(/\[(\d+)%\]/)
      if (!match) throw new Error(`amixer: unexpected output: ${out}`)
      return parseInt(match[1], 10)
    }
  }
}

async function setVolume(backend: BackendInfo, percent: number): Promise<void> {
  switch (backend.name) {
    case 'wpctl':
      await exec(backend.path, ['set-volume', '@DEFAULT_AUDIO_SINK@', String(percent / 100)])
      break
    case 'pactl':
      await exec(backend.path, ['set-sink-volume', '@DEFAULT_SINK@', `${percent}%`])
      break
    case 'amixer':
      await exec(backend.path, ['set', 'Master', `${percent}%`])
      break
  }
}

export async function duckVolume(reductionPercent: number): Promise<void> {
  if (reductionPercent <= 0 || savedVolume !== null) return

  const backend = detectBackend()
  if (!backend) {
    console.warn('[volume] No audio backend found (wpctl/pactl/amixer)')
    return
  }

  try {
    const current = await getVolume(backend)
    savedVolume = current
    const target = Math.max(0, current - reductionPercent)
    await setVolume(backend, target)
    console.log(`[volume] Ducked: ${current}% -> ${target}% (reduction: ${reductionPercent}%)`)
  } catch (err) {
    savedVolume = null
    console.warn('[volume] Duck failed:', err)
  }
}

export async function restoreVolume(): Promise<void> {
  if (savedVolume === null) return

  const backend = detectBackend()
  if (!backend) return

  const vol = savedVolume
  savedVolume = null

  try {
    await setVolume(backend, vol)
    console.log(`[volume] Restored to ${vol}%`)
  } catch (err) {
    console.warn('[volume] Restore failed:', err)
  }
}

// ─── Per-stream ducking (for TTS) ───────────────────────────
// Lowers all existing audio streams individually via pactl,
// so the TTS stream (created after ducking) plays at full volume.

interface SavedStream {
  index: number
  volume: number // percentage
}

let savedStreams: SavedStream[] | null = null

async function listSinkInputs(pactlPath: string): Promise<SavedStream[]> {
  const out = await exec(pactlPath, ['list', 'sink-inputs'])
  const inputs: SavedStream[] = []
  // Output is blocks separated by "Sink Input #<index>"
  const blocks = out.split(/^Sink Input #(\d+)/m).slice(1)
  for (let i = 0; i < blocks.length; i += 2) {
    const index = parseInt(blocks[i], 10)
    const body = blocks[i + 1] || ''
    const volMatch = body.match(/Volume:.*?(\d+)%/)
    if (volMatch) {
      inputs.push({ index, volume: parseInt(volMatch[1], 10) })
    }
  }
  return inputs
}

export async function duckOtherStreams(reductionPercent: number): Promise<void> {
  if (reductionPercent <= 0 || savedStreams !== null) return

  const pactlPath = findBinaryInPath('pactl')
  if (!pactlPath) {
    console.warn('[volume] pactl not found — per-stream ducking unavailable')
    return
  }

  try {
    const inputs = await listSinkInputs(pactlPath)
    if (inputs.length === 0) return

    savedStreams = inputs
    for (const input of inputs) {
      const target = Math.max(0, input.volume - reductionPercent)
      await exec(pactlPath, ['set-sink-input-volume', String(input.index), `${target}%`])
    }
    console.log(`[volume] Ducked ${inputs.length} stream(s) by ${reductionPercent}%`)
  } catch (err) {
    savedStreams = null
    console.warn('[volume] Duck streams failed:', err)
  }
}

export async function restoreOtherStreams(): Promise<void> {
  if (!savedStreams) return

  const pactlPath = findBinaryInPath('pactl')
  if (!pactlPath) { savedStreams = null; return }

  const streams = savedStreams
  savedStreams = null

  for (const input of streams) {
    try {
      await exec(pactlPath, ['set-sink-input-volume', String(input.index), `${input.volume}%`])
    } catch {
      // Stream may have ended — ignore
    }
  }
  console.log(`[volume] Restored ${streams.length} stream(s)`)
}

/** Reset module state for testing */
export function _resetForTesting(): void {
  cachedBackend = undefined
  savedVolume = null
  savedStreams = null
}
