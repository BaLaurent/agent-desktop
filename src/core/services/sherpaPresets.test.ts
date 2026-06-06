import { describe, it, expect } from 'vitest'
import { SHERPA_MODEL_PRESETS } from './sherpaPresets'

describe('SHERPA_MODEL_PRESETS', () => {
  it('has at least the Parakeet preset', () => {
    expect(SHERPA_MODEL_PRESETS.length).toBeGreaterThanOrEqual(1)
    expect(SHERPA_MODEL_PRESETS.some((p) => p.id.includes('parakeet'))).toBe(true)
  })

  it('every preset has unique id and non-empty repo + files', () => {
    const ids = new Set<string>()
    for (const p of SHERPA_MODEL_PRESETS) {
      expect(p.id).toBeTruthy()
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
      expect(p.repo).toBeTruthy()
      expect(p.files.length).toBeGreaterThan(0)
      expect(p.label).toBeTruthy()
    }
  })
})
