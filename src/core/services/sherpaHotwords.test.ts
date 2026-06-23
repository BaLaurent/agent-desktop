import { describe, it, expect } from 'vitest'
import { tokenizeEntry, resolveScore } from './sherpaHotwords'

// Minimal piece set spelling "Zorglub" as ▁Z + or + gl + ub (mirrors the real tokens.txt).
const PIECES = new Set<string>(['▁Z', 'or', 'gl', 'ub', '▁To', 'to', 'lu', 'b'])

describe('tokenizeEntry', () => {
  it('greedily splits a word into ▁-prefixed pieces', () => {
    expect(tokenizeEntry('Zorglub', PIECES)).toBe('▁Z or gl ub')
  })

  it('prefixes ▁ at the start of every word in a phrase', () => {
    expect(tokenizeEntry('Toto Zorglub', PIECES)).toBe('▁To to ▁Z or gl ub')
  })

  it('returns null when a character cannot be encoded', () => {
    expect(tokenizeEntry('Zx', PIECES)).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(tokenizeEntry('   ', PIECES)).toBeNull()
  })
})

describe('resolveScore', () => {
  it('maps sensitivity presets to scores', () => {
    expect(resolveScore('soft', '')).toBe(2.0)
    expect(resolveScore('normal', '')).toBe(4.0)
    expect(resolveScore('strong', '')).toBe(6.0)
  })

  it('falls back to normal for an unknown sensitivity', () => {
    expect(resolveScore('bogus', '')).toBe(4.0)
  })

  it('prefers a valid positive override', () => {
    expect(resolveScore('soft', '9.5')).toBe(9.5)
  })

  it('ignores a blank or invalid override', () => {
    expect(resolveScore('normal', '')).toBe(4.0)
    expect(resolveScore('normal', 'abc')).toBe(4.0)
    expect(resolveScore('normal', '-3')).toBe(4.0)
  })
})
