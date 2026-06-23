import { describe, it, expect } from 'vitest'
import { tokenizeEntry, resolveScore, buildHotwords } from './sherpaHotwords'

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

  it('clamps an override to the accepted boost-score bounds', () => {
    expect(resolveScore('normal', '50')).toBe(10)
    expect(resolveScore('normal', '0.1')).toBe(0.5)
  })

  it('ignores a blank or invalid override', () => {
    expect(resolveScore('normal', '')).toBe(4.0)
    expect(resolveScore('normal', 'abc')).toBe(4.0)
    expect(resolveScore('normal', '-3')).toBe(4.0)
  })
})

describe('buildHotwords', () => {
  const pieces = new Set<string>(['▁Z', 'or', 'gl', 'ub'])

  it('self-tokenizes when no bpe.vocab is present (fallback path)', () => {
    const r = buildHotwords({
      modelDir: '/models/parakeet',
      fileNames: ['encoder.int8.onnx', 'tokens.txt'],
      lexicon: ['Zorglub'],
      pieces,
    })
    expect(r.content).toBe('▁Z or gl ub\n')
    expect(r.modelingUnit).toBeUndefined()
    expect(r.bpeVocabPath).toBeUndefined()
    expect(r.skipped).toEqual([])
  })

  it('reports entries that cannot be tokenized', () => {
    const r = buildHotwords({
      modelDir: '/models/parakeet',
      fileNames: ['tokens.txt'],
      lexicon: ['Zorglub', 'Zx'],
      pieces,
    })
    expect(r.content).toBe('▁Z or gl ub\n')
    expect(r.skipped).toEqual(['Zx'])
  })

  it('uses the official path with plain text when a bpe.vocab is present', () => {
    const r = buildHotwords({
      modelDir: '/models/parakeet',
      fileNames: ['encoder.int8.onnx', 'tokens.txt', 'bpe.vocab'],
      lexicon: ['Zorglub', 'Toto'],
      pieces,
    })
    expect(r.content).toBe('Zorglub\nToto\n')
    expect(r.modelingUnit).toBe('cjkchar+bpe')
    expect(r.bpeVocabPath).toBe('/models/parakeet/bpe.vocab')
    expect(r.skipped).toEqual([])
  })

  it('returns empty content for an empty lexicon', () => {
    const r = buildHotwords({ modelDir: '/m', fileNames: ['tokens.txt'], lexicon: [], pieces })
    expect(r.content).toBe('')
    expect(r.skipped).toEqual([])
  })
})
