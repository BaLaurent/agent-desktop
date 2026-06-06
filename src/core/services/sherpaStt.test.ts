import { describe, it, expect } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { detectArchitecture, validateConfig } from './sherpaStt'

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

const hasAddon = (() => { try { require('sherpa-onnx'); return true } catch { return false } })()

describe.skipIf(!hasAddon)('transcribe (requires sherpa-onnx + a model)', () => {
  it('throws a clear error when the model path is unset', async () => {
    const { transcribe } = await import('./sherpaStt')
    const db = await makeDb('')
    await expect(transcribe(db as any, Buffer.from([]))).rejects.toThrow(/model|empty/i)
  })
})
