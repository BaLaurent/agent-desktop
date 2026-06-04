import { execFileAsync as exec } from './exec'
import { findBinaryInPath } from './env'
import { createLogger, errToCtx } from './logger'

const log = createLogger('mediaPlayers')

let cachedPlayerctl: string | null | undefined = undefined
let pausedPlayers: string[] | null = null
let pausePromise: Promise<void> | null = null

function detectPlayerctl(): string | null {
  if (cachedPlayerctl !== undefined) return cachedPlayerctl
  cachedPlayerctl = findBinaryInPath('playerctl')
  return cachedPlayerctl
}

/** Pause every MPRIS player currently in "Playing" status; remember which. Idempotent. */
export function pauseMediaPlayers(): Promise<void> {
  if (pausedPlayers !== null) return Promise.resolve()

  const playerctl = detectPlayerctl()
  if (!playerctl) {
    log.warn('playerctl not found — media pause unavailable')
    return Promise.resolve()
  }

  pausePromise = (async () => {
    try {
      const listOut = await exec(playerctl, ['--list-all'])
      const players = listOut.split('\n').map((s) => s.trim()).filter(Boolean)

      const paused: string[] = []
      for (const player of players) {
        let status: string
        try {
          status = await exec(playerctl, ['-p', player, 'status'])
        } catch {
          continue // player vanished between list and status
        }
        if (status === 'Playing') {
          try {
            await exec(playerctl, ['-p', player, 'pause'])
            paused.push(player)
          } catch {
            // player vanished between status and pause
          }
        }
      }
      pausedPlayers = paused
      log.debug('Media players paused', { count: paused.length })
    } catch (err) {
      pausedPlayers = null
      log.warn('Pause media players failed', errToCtx(err))
    }
  })()
  return pausePromise
}

/** Resume only the players paused by pauseMediaPlayers(). Best-effort, idempotent. */
export async function resumeMediaPlayers(): Promise<void> {
  if (pausePromise) {
    await pausePromise
    pausePromise = null
  }

  if (pausedPlayers === null) return

  const playerctl = detectPlayerctl()
  if (!playerctl) {
    pausedPlayers = null
    return
  }

  const players = pausedPlayers
  pausedPlayers = null

  for (const player of players) {
    try {
      await exec(playerctl, ['-p', player, 'play'])
    } catch {
      // player closed between pause and resume
    }
  }
  log.debug('Media players resumed', { count: players.length })
}

/** Reset module state for testing */
export function _resetForTesting(): void {
  cachedPlayerctl = undefined
  pausedPlayers = null
  pausePromise = null
}
