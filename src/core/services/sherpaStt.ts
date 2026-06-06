import type Database from 'better-sqlite3'
import * as fs from 'fs/promises'
import * as path from 'path'
import { getSetting } from '../utils/db'

export type SherpaFamily = 'transducer' | 'whisper' | 'paraformer' | 'nemoCtc'

export interface SherpaDetection {
  family: SherpaFamily
  /** Role → basename, relative to the model folder. */
  models: Record<string, string>
  /** Basename of the tokens/vocab file. */
  tokens: string
}

const isOnnx = (f: string) => f.toLowerCase().endsWith('.onnx')
const has = (f: string, kw: string) => f.toLowerCase().includes(kw)

/**
 * Map a model folder's filenames to a sherpa-onnx offline family + role assignment.
 * Pure: takes basenames, returns relative names. Throws with a descriptive message
 * when the folder does not match any supported sherpa layout.
 */
export function detectArchitecture(fileNames: string[]): SherpaDetection {
  const onnx = fileNames.filter(isOnnx)
  const tokens =
    fileNames.find((f) => /(^|[-_/])tokens\.txt$/i.test(f)) ||
    fileNames.find((f) => /tokens\.txt$/i.test(f)) ||
    fileNames.find((f) => /vocab\.txt$/i.test(f))
  if (!tokens) {
    throw new Error(
      `No tokens.txt/vocab.txt found in model folder (files: ${fileNames.join(', ') || 'none'}).`,
    )
  }

  const encoder = onnx.find((f) => has(f, 'encoder'))
  const joiner = onnx.find((f) => has(f, 'joiner'))
  const decoder = onnx.find((f) => has(f, 'decoder') && !has(f, 'joiner'))

  if (encoder && decoder && joiner) {
    return { family: 'transducer', models: { encoder, decoder, joiner }, tokens }
  }
  if (encoder && decoder) {
    return { family: 'whisper', models: { encoder, decoder }, tokens }
  }

  const paraformer = onnx.find((f) => has(f, 'paraformer'))
  if (paraformer) {
    return { family: 'paraformer', models: { model: paraformer }, tokens }
  }
  const ctc = onnx.find((f) => has(f, 'ctc'))
  if (ctc) {
    return { family: 'nemoCtc', models: { model: ctc }, tokens }
  }
  if (onnx.length === 1) {
    throw new Error(
      `Ambiguous single-model folder "${onnx[0]}": cannot tell paraformer from CTC by filename. ` +
        `Use a transducer/whisper model, or rename the file to include "paraformer" or "ctc".`,
    )
  }
  throw new Error(
    `Unrecognized sherpa model layout. onnx files: ${onnx.join(', ') || 'none'}; tokens: ${tokens}.`,
  )
}

// ── validateConfig ────────────────────────────────────────────────────────────

export interface SherpaValidateResult {
  modelPath: string
  files: string[]
  detected: SherpaFamily | null
  ok: boolean
  detail?: string
}

export async function validateConfig(db: Database.Database): Promise<SherpaValidateResult> {
  const modelPath = getSetting(db, 'sherpa_modelPath') || ''
  if (!modelPath) return { modelPath: '', files: [], detected: null, ok: false, detail: 'No model folder set.' }
  let files: string[] = []
  try {
    files = await fs.readdir(modelPath)
  } catch {
    return { modelPath, files: [], detected: null, ok: false, detail: 'Folder not readable.' }
  }
  try {
    const d = detectArchitecture(files)
    return { modelPath, files, detected: d.family, ok: true }
  } catch (e) {
    return { modelPath, files, detected: null, ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

// ── transcribe (lazy addon + cached recognizer) ───────────────────────────────

import * as os from 'os'

const MAX_BUFFER_SIZE = 50 * 1024 * 1024

// Loading a model is expensive; cache the OfflineRecognizer keyed by absolute model path.
let cached: { modelPath: string; recognizer: unknown } | null = null

export function resetRecognizerCache(): void {
  cached = null
}

function loadSherpa(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('sherpa-onnx')
  } catch {
    throw new Error('sherpa-onnx is not installed. Run: npm install sherpa-onnx')
  }
}

function buildModelConfig(dir: string, d: SherpaDetection) {
  const abs = (n: string) => path.join(dir, n)
  const base = { tokens: abs(d.tokens), numThreads: 1, provider: 'cpu', debug: 0 as const }
  switch (d.family) {
    case 'transducer':
      return { ...base, transducer: { encoder: abs(d.models.encoder), decoder: abs(d.models.decoder), joiner: abs(d.models.joiner) } }
    case 'whisper':
      return { ...base, whisper: { encoder: abs(d.models.encoder), decoder: abs(d.models.decoder) } }
    case 'paraformer':
      return { ...base, paraformer: { model: abs(d.models.model) } }
    case 'nemoCtc':
      return { ...base, nemoCtc: { model: abs(d.models.model) } }
  }
}

function getRecognizer(sherpa: any, modelPath: string, d: SherpaDetection): unknown {
  if (cached && cached.modelPath === modelPath) return cached.recognizer
  const recognizer = sherpa.createOfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: buildModelConfig(modelPath, d),
  })
  cached = { modelPath, recognizer }
  return recognizer
}

export async function transcribe(db: Database.Database, wavBuffer: Buffer): Promise<{ text: string }> {
  if (!wavBuffer || wavBuffer.length === 0) throw new Error('Empty audio buffer')
  if (wavBuffer.length > MAX_BUFFER_SIZE) throw new Error(`Audio buffer too large (max ${MAX_BUFFER_SIZE / 1024 / 1024}MB)`)
  const modelPath = getSetting(db, 'sherpa_modelPath')
  if (!modelPath) throw new Error('Sherpa model path not configured. Go to Settings > Voice Input.')

  const files = await fs.readdir(modelPath)
  const detection = detectArchitecture(files)
  const sherpa = loadSherpa()
  const recognizer: any = getRecognizer(sherpa, modelPath, detection)

  // sherpa reads WAV from disk; mirror whisper's tmp-file approach.
  const tmpFile = path.join(os.tmpdir(), `agent-sherpa-${process.pid}-${wavBuffer.length}.wav`)
  try {
    await fs.writeFile(tmpFile, wavBuffer)
    const wave = sherpa.readWave(tmpFile) // { samples: Float32Array, sampleRate: number }
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
    recognizer.decode(stream)
    const result = recognizer.getResult(stream)
    return { text: (result?.text || '').trim() }
  } finally {
    await fs.unlink(tmpFile).catch(() => {})
  }
}
