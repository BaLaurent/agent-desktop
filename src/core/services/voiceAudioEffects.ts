import type Database from 'better-sqlite3'
import { getSetting } from '../utils/db'
import { duckVolume, restoreVolume } from '../utils/volume'
import { pauseMediaPlayers, resumeMediaPlayers } from '../utils/mediaPlayers'

/** Audio side-effects applied when voice recording starts (single source of truth). */
export async function applyVoiceAudioEffects(db: Database.Database): Promise<void> {
  const duck = Number(getSetting(db, 'voice_volumeDuck')) || 0
  if (duck > 0) await duckVolume(duck)
  if (getSetting(db, 'voice_pauseMediaPlayers') === 'true') await pauseMediaPlayers()
}

/** Reverses applyVoiceAudioEffects when voice recording ends. Both calls are idempotent. */
export async function clearVoiceAudioEffects(db: Database.Database): Promise<void> {
  await restoreVolume()
  await resumeMediaPlayers()
}
