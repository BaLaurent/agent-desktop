import { describe, it, expect } from 'vitest'
import {
  shortenModelName,
  DEFAULT_MODEL,
  HAIKU_MODEL,
  MODEL_OPTIONS,
  PERMISSION_OPTIONS,
  PERMISSION_LABELS,
  AI_OVERRIDE_KEYS,
  SETTING_DEFS,
} from './constants'

describe('shortenModelName', () => {
  it('strips claude- prefix and date suffix', () => {
    expect(shortenModelName('claude-sonnet-4-5-20250929')).toBe('sonnet-4-5')
    expect(shortenModelName('claude-opus-4-6')).toBe('opus-4-6')
    expect(shortenModelName('claude-haiku-4-5-20251001')).toBe('haiku-4-5')
  })

  it('handles model without date suffix', () => {
    expect(shortenModelName('claude-opus-4-6')).toBe('opus-4-6')
  })

  it('handles model without claude- prefix', () => {
    expect(shortenModelName('some-model-20250101')).toBe('some-model')
  })

  it('returns empty for empty string', () => {
    expect(shortenModelName('')).toBe('')
  })
})

describe('constants integrity', () => {
  it('DEFAULT_MODEL matches first MODEL_OPTIONS entry', () => {
    expect(DEFAULT_MODEL).toBe(MODEL_OPTIONS[0].value)
  })

  it('HAIKU_MODEL is in MODEL_OPTIONS', () => {
    expect(MODEL_OPTIONS.some((o) => o.value === HAIKU_MODEL)).toBe(true)
  })

  it('PERMISSION_LABELS has entry for each PERMISSION_OPTIONS value', () => {
    for (const opt of PERMISSION_OPTIONS) {
      expect(PERMISSION_LABELS[opt.value]).toBe(opt.label)
    }
  })

  it('SETTING_DEFS keys are subset of AI_OVERRIDE_KEYS', () => {
    for (const def of SETTING_DEFS) {
      expect(AI_OVERRIDE_KEYS).toContain(def.key)
    }
  })
})
