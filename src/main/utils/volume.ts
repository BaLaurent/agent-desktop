import { execFile } from 'child_process'
import { findBinaryInPath } from './env'

interface BackendInfo {
  name: 'wpctl' | 'pactl' | 'amixer'
  path: string
}

let cachedBackend: BackendInfo | null | undefined = undefined
let savedVolume: number | null = null
let duckPromise: Promise<void> | null = null

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

export function duckVolume(reductionPercent: number): Promise<void> {
  if (reductionPercent <= 0 || savedVolume !== null) return Promise.resolve()

  const backend = detectBackend()
  if (!backend) {
    console.warn('[volume] No audio backend found (wpctl/pactl/amixer)')
    return Promise.resolve()
  }

  duckPromise = (async () => {
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
  })()
  return duckPromise
}

export async function restoreVolume(): Promise<void> {
  if (duckPromise) {
    await duckPromise
    duckPromise = null
  }

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
  appName?: string // application.process.binary for fallback matching
}

let savedStreams: SavedStream[] | null = null
let duckStreamsPromise: Promise<void> | null = null

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
      const appMatch = body.match(/application\.process\.binary\s*=\s*"([^"]+)"/)
      inputs.push({ index, volume: parseInt(volMatch[1], 10), appName: appMatch?.[1] })
    }
  }
  return inputs
}

export function duckOtherStreams(reductionPercent: number): Promise<void> {
  if (reductionPercent <= 0 || savedStreams !== null) return Promise.resolve()

  const pactlPath = findBinaryInPath('pactl')
  if (!pactlPath) {
    console.warn('[volume] pactl not found — per-stream ducking unavailable')
    return Promise.resolve()
  }

  duckStreamsPromise = (async () => {
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
  })()
  return duckStreamsPromise
}

export async function restoreOtherStreams(): Promise<void> {
  if (duckStreamsPromise) {
    await duckStreamsPromise
    duckStreamsPromise = null
  }

  if (!savedStreams) return

  const pactlPath = findBinaryInPath('pactl')
  if (!pactlPath) { savedStreams = null; return }

  const streams = savedStreams
  savedStreams = null

  // Re-list current sink inputs to handle streams that changed index
  let currentInputs: SavedStream[] | null = null
  try {
    currentInputs = await listSinkInputs(pactlPath)
  } catch {
    // Fall through to index-only restore below
  }

  if (!currentInputs) {
    // Fallback: try restoring by original index (pre-fix behavior)
    for (const saved of streams) {
      try {
        await exec(pactlPath, ['set-sink-input-volume', String(saved.index), `${saved.volume}%`])
      } catch {
        // Stream may have ended
      }
    }
    console.log(`[volume] Restored ${streams.length} stream(s) (index-only fallback)`)
    return
  }

  const currentIndices = new Set(currentInputs.map(s => s.index))
  const matched = new Set<number>()

  // Pass 1: restore streams still at their original index
  for (const saved of streams) {
    if (!currentIndices.has(saved.index)) continue
    try {
      await exec(pactlPath, ['set-sink-input-volume', String(saved.index), `${saved.volume}%`])
      matched.add(saved.index)
    } catch {
      // Stream ended between re-list and restore
    }
  }

  // Pass 2: match remaining saved streams to current streams by app name
  for (const saved of streams) {
    if (matched.has(saved.index) || !saved.appName) continue
    const candidate = currentInputs.find(c => c.appName === saved.appName && !matched.has(c.index))
    if (candidate) {
      try {
        await exec(pactlPath, ['set-sink-input-volume', String(candidate.index), `${saved.volume}%`])
        matched.add(candidate.index)
      } catch {
        // Stream ended between re-list and restore
      }
    }
  }

  console.log(`[volume] Restored ${matched.size} stream(s)`)
}

/** Reset module state for testing */
export function _resetForTesting(): void {
  cachedBackend = undefined
  savedVolume = null
  savedStreams = null
  duckPromise = null
  duckStreamsPromise = null
}
