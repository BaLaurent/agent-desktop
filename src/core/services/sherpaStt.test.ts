import { describe, it, expect } from 'vitest'
import { detectArchitecture } from './sherpaStt'

describe('detectArchitecture', () => {
  it('detects a transducer (encoder + decoder + joiner + tokens)', () => {
    const d = detectArchitecture([
      'encoder-epoch-99-avg-1.onnx',
      'decoder-epoch-99-avg-1.onnx',
      'joiner-epoch-99-avg-1.onnx',
      'tokens.txt',
    ])
    expect(d.family).toBe('transducer')
    expect(d.models).toEqual({
      encoder: 'encoder-epoch-99-avg-1.onnx',
      decoder: 'decoder-epoch-99-avg-1.onnx',
      joiner: 'joiner-epoch-99-avg-1.onnx',
    })
    expect(d.tokens).toBe('tokens.txt')
  })

  it('detects whisper (encoder + decoder, no joiner)', () => {
    const d = detectArchitecture(['tiny-encoder.onnx', 'tiny-decoder.onnx', 'tiny-tokens.txt'])
    expect(d.family).toBe('whisper')
    expect(d.models).toEqual({ encoder: 'tiny-encoder.onnx', decoder: 'tiny-decoder.onnx' })
    expect(d.tokens).toBe('tiny-tokens.txt')
  })

  it('accepts vocab.txt as the tokens file', () => {
    const d = detectArchitecture(['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'vocab.txt'])
    expect(d.family).toBe('transducer')
    expect(d.tokens).toBe('vocab.txt')
  })

  it('throws a descriptive error when no tokens file is present', () => {
    expect(() => detectArchitecture(['encoder.onnx', 'decoder.onnx', 'joiner.onnx'])).toThrow(/tokens/i)
  })

  it('detects paraformer (single model named paraformer + tokens)', () => {
    const d = detectArchitecture(['model.int8.paraformer.onnx', 'tokens.txt'])
    expect(d.family).toBe('paraformer')
    expect(d.models).toEqual({ model: 'model.int8.paraformer.onnx' })
  })

  it('detects nemoCtc (single model named ctc + tokens)', () => {
    const d = detectArchitecture(['model.ctc.int8.onnx', 'tokens.txt'])
    expect(d.family).toBe('nemoCtc')
    expect(d.models).toEqual({ model: 'model.ctc.int8.onnx' })
  })

  it('throws on an ambiguous single model (no paraformer/ctc hint)', () => {
    expect(() => detectArchitecture(['model.onnx', 'tokens.txt'])).toThrow(/ambiguous/i)
  })
})
