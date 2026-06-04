import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/volume', () => ({
  duckVolume: vi.fn(),
  restoreVolume: vi.fn(),
}))
vi.mock('../utils/mediaPlayers', () => ({
  pauseMediaPlayers: vi.fn(),
  resumeMediaPlayers: vi.fn(),
}))
vi.mock('../utils/db', () => ({
  getSetting: vi.fn(),
}))

import { duckVolume, restoreVolume } from '../utils/volume'
import { pauseMediaPlayers, resumeMediaPlayers } from '../utils/mediaPlayers'
import { getSetting } from '../utils/db'
import { applyVoiceAudioEffects, clearVoiceAudioEffects } from './voiceAudioEffects'

const db = {} as any

function settings(map: Record<string, string>) {
  vi.mocked(getSetting).mockImplementation((_db, key) => map[key] ?? '')
}

describe('voiceAudioEffects', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applies both duck and pause when both are enabled', async () => {
    settings({ voice_volumeDuck: '30', voice_pauseMediaPlayers: 'true' })
    await applyVoiceAudioEffects(db)
    expect(duckVolume).toHaveBeenCalledWith(30)
    expect(pauseMediaPlayers).toHaveBeenCalledOnce()
  })

  it('applies only duck when pause is disabled', async () => {
    settings({ voice_volumeDuck: '30', voice_pauseMediaPlayers: 'false' })
    await applyVoiceAudioEffects(db)
    expect(duckVolume).toHaveBeenCalledWith(30)
    expect(pauseMediaPlayers).not.toHaveBeenCalled()
  })

  it('applies only pause when duck is 0', async () => {
    settings({ voice_volumeDuck: '0', voice_pauseMediaPlayers: 'true' })
    await applyVoiceAudioEffects(db)
    expect(duckVolume).not.toHaveBeenCalled()
    expect(pauseMediaPlayers).toHaveBeenCalledOnce()
  })

  it('applies nothing when both are disabled', async () => {
    settings({ voice_volumeDuck: '0', voice_pauseMediaPlayers: 'false' })
    await applyVoiceAudioEffects(db)
    expect(duckVolume).not.toHaveBeenCalled()
    expect(pauseMediaPlayers).not.toHaveBeenCalled()
  })

  it('clear restores volume and resumes media', async () => {
    await clearVoiceAudioEffects(db)
    expect(restoreVolume).toHaveBeenCalledOnce()
    expect(resumeMediaPlayers).toHaveBeenCalledOnce()
  })
})
