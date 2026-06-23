import { describe, it, expect } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { detectArchitecture, validateConfig, parseWavPcm16, buildRecognizerConfig } from './sherpaStt'

function makeWav(samples: number[], sampleRate = 16000): Buffer {
  const dataLen = samples.length * 2
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40)
  samples.forEach((s, i) => buf.writeInt16LE(s, 44 + i * 2))
  return buf
}

describe('parseWavPcm16', () => {
  it('parses sample rate and normalized mono samples', () => {
    const wav = makeWav([0, 16384, -32768, 32767], 16000)
    const { samples, sampleRate } = parseWavPcm16(wav)
    expect(sampleRate).toBe(16000)
    expect(samples.length).toBe(4)
    expect(samples[0]).toBeCloseTo(0)
    expect(samples[1]).toBeCloseTo(0.5)
    expect(samples[2]).toBeCloseTo(-1)
  })

  it('throws on a WAV without a data chunk', () => {
    const bad = Buffer.alloc(44)
    bad.write('RIFF', 0); bad.write('WAVE', 8); bad.write('fmt ', 12)
    bad.writeUInt16LE(1, 22); bad.writeUInt32LE(16000, 24)
    expect(() => parseWavPcm16(bad)).toThrow(/data chunk/i)
  })
})


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

async function makeDb(modelPath: string) {
  const { createTestDb } = await import('../../main/__tests__/db-helper')
  const db = await createTestDb()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('sherpa_modelPath', modelPath)
  return db
}

describe('validateConfig', () => {
  it('reports ok=false with no model path set', async () => {
    const db = await makeDb('')
    const r = await validateConfig(db as any)
    expect(r.ok).toBe(false)
    expect(r.modelPath).toBe('')
  })

  it('reports the detected family for a transducer folder', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sherpa-test-'))
    for (const f of ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt']) {
      await fs.writeFile(path.join(dir, f), 'x')
    }
    const db = await makeDb(dir)
    const r = await validateConfig(db as any)
    expect(r.ok).toBe(true)
    expect(r.detected).toBe('transducer')
    expect(r.files).toContain('joiner.onnx')
    await fs.rm(dir, { recursive: true, force: true })
  })
})

const hasAddon = (() => { try { require('sherpa-onnx-node'); return true } catch { return false } })()

describe.skipIf(!hasAddon)('transcribe (requires sherpa-onnx-node + a model)', () => {
  it('throws a clear error when the model path is unset', async () => {
    const { transcribe } = await import('./sherpaStt')
    const db = await makeDb('')
    await expect(transcribe(db as any, Buffer.from([]))).rejects.toThrow(/model|empty/i)
  })
})

describe('buildRecognizerConfig', () => {
  const detection = {
    family: 'transducer' as const,
    models: { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx' },
    tokens: 'tokens.txt',
  }

  it('uses greedy_search with no hotwords when hot is null', () => {
    const cfg = buildRecognizerConfig('/m', detection, null) as any
    expect(cfg.decodingMethod ?? 'greedy_search').toBe('greedy_search')
    expect(cfg.hotwordsFile).toBeUndefined()
    expect(cfg.modelConfig.transducer.encoder).toBe('/m/encoder.onnx')
  })

  it('switches to modified_beam_search and sets the hotwords file/score', () => {
    const cfg = buildRecognizerConfig('/m', detection, {
      file: '/m/.agent-hotwords.txt',
      score: 4.0,
    }) as any
    expect(cfg.decodingMethod).toBe('modified_beam_search')
    expect(cfg.hotwordsFile).toBe('/m/.agent-hotwords.txt')
    expect(cfg.hotwordsScore).toBe(4.0)
  })

  it('adds modelingUnit + bpeVocab on the model config for the official path', () => {
    const cfg = buildRecognizerConfig('/m', detection, {
      file: '/m/.agent-hotwords.txt',
      score: 4.0,
      modelingUnit: 'cjkchar+bpe',
      bpeVocabPath: '/m/bpe.vocab',
    }) as any
    expect(cfg.modelConfig.modelingUnit).toBe('cjkchar+bpe')
    expect(cfg.modelConfig.bpeVocab).toBe('/m/bpe.vocab')
  })
})
