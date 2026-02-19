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

/** Reset module state for testing */
export function _resetForTesting(): void {
  cachedBackend = undefined
  savedVolume = null
}
