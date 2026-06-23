import type Database from 'better-sqlite3'
import * as fs from 'fs/promises'
import * as path from 'path'
import { getSetting } from '../utils/db'
import { loadTokenPieces, buildHotwords, resolveScore } from './sherpaHotwords'

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

const MAX_BUFFER_SIZE = 50 * 1024 * 1024

// Loading a model is expensive; cache the OfflineRecognizer keyed by model path + hotwords signature.
let cached: { key: string; recognizer: unknown } | null = null

export function resetRecognizerCache(): void {
  cached = null
}

export interface RecognizerHotwords {
  file: string
  score: number
  /** Encodes the built hotwords content + score; changes whenever the lexicon does. */
  signature: string
  modelingUnit?: string
  bpeVocabPath?: string
}

/** Cache key for the recognizer: model path + hotwords signature (lexicon-content-sensitive). */
export function recognizerCacheKey(modelPath: string, hot: RecognizerHotwords | null): string {
  return modelPath + '|' + (hot ? hot.signature : '')
}

/** Assemble the OfflineRecognizer config. Pure: no addon, no I/O — safe to unit test. */
export function buildRecognizerConfig(
  modelPath: string,
  detection: SherpaDetection,
  hot: RecognizerHotwords | null,
): Record<string, unknown> {
  const modelConfig = buildModelConfig(modelPath, detection) as Record<string, unknown>
  const config: Record<string, unknown> = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig,
  }
  if (hot) {
    config.decodingMethod = 'modified_beam_search'
    config.hotwordsFile = hot.file
    config.hotwordsScore = hot.score
    if (hot.modelingUnit) modelConfig.modelingUnit = hot.modelingUnit
    if (hot.bpeVocabPath) modelConfig.bpeVocab = hot.bpeVocabPath
  }
  return config
}

function loadSherpa(): any {
  try {
    // sherpa-onnx-node is the NATIVE N-API addon (not the WASM `sherpa-onnx` package):
    // no WASM memory limits, and it handles NeMo transducer decoders correctly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('sherpa-onnx-node')
  } catch {
    // Either not installed (dev) or no native prebuild for this platform/arch
    // (e.g. Windows ARM64, which sherpa-onnx-node does not ship). Whisper STT still works.
    throw new Error(
      `Sherpa STT is unavailable on this platform (${process.platform}/${process.arch}) — ` +
        'the sherpa-onnx-node native binary is missing. Use the Whisper engine instead, ' +
        'or install it with: npm install sherpa-onnx-node',
    )
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

function getRecognizer(
  sherpa: any,
  modelPath: string,
  d: SherpaDetection,
  hot: RecognizerHotwords | null,
): unknown {
  const key = recognizerCacheKey(modelPath, hot)
  if (cached && cached.key === key) return cached.recognizer
  // Native API: OfflineRecognizer is a class (no createOfflineRecognizer factory).
  const recognizer = new sherpa.OfflineRecognizer(buildRecognizerConfig(modelPath, d, hot))
  cached = { key, recognizer }
  return recognizer
}

/**
 * Parse a PCM16 WAV (mono or multi-channel) into an in-cage Float32Array + sample rate.
 * Channel 0 is taken for multi-channel input. The renderer sends 16 kHz mono PCM16.
 */
export function parseWavPcm16(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  const numChannels = buf.readUInt16LE(22) || 1
  const sampleRate = buf.readUInt32LE(24)
  let offset = 12
  let dataOffset = -1
  let dataLen = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const sz = buf.readUInt32LE(offset + 4)
    if (id === 'data') { dataOffset = offset + 8; dataLen = sz; break }
    offset += 8 + sz + (sz & 1)
  }
  if (dataOffset < 0) throw new Error('Invalid WAV: no data chunk')
  const frames = Math.floor(dataLen / 2 / numChannels)
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * numChannels * 2) / 32768
  }
  return { samples, sampleRate }
}

export async function transcribe(db: Database.Database, wavBuffer: Buffer): Promise<{ text: string }> {
  if (!wavBuffer || wavBuffer.length === 0) throw new Error('Empty audio buffer')
  if (wavBuffer.length > MAX_BUFFER_SIZE) throw new Error(`Audio buffer too large (max ${MAX_BUFFER_SIZE / 1024 / 1024}MB)`)
  const modelPath = getSetting(db, 'sherpa_modelPath')
  if (!modelPath) throw new Error('Sherpa model path not configured. Go to Settings > Voice Input.')

  const files = await fs.readdir(modelPath)
  const detection = detectArchitecture(files)

  // Resolve the custom-word lexicon into hotwords (transducer only; no-op otherwise).
  let hot: RecognizerHotwords | null = null
  let lexicon: string[] = []
  try {
    const parsed = JSON.parse(getSetting(db, 'stt_lexicon') || '[]')
    if (Array.isArray(parsed)) lexicon = parsed.filter((e): e is string => typeof e === 'string')
  } catch {
    lexicon = []
  }
  if (lexicon.length > 0 && detection.family === 'transducer') {
    const pieces = await loadTokenPieces(path.join(modelPath, detection.tokens))
    const built = buildHotwords({ modelDir: modelPath, fileNames: files, lexicon, pieces })
    if (built.content.trim().length > 0) {
      const file = path.join(modelPath, '.agent-hotwords.txt')
      await fs.writeFile(file, built.content, 'utf8')
      const score = resolveScore(
        getSetting(db, 'sherpa_hotwordsSensitivity') || 'normal',
        getSetting(db, 'sherpa_hotwordsScoreOverride') || '',
      )
      // signature encodes the tokenized lexicon content + score so any lexicon edit busts the cache.
      const signature = `${score}:${built.content}`
      hot = { file, score, signature, modelingUnit: built.modelingUnit, bpeVocabPath: built.bpeVocabPath }
    }
  }

  const sherpa = loadSherpa()
  const recognizer: any = getRecognizer(sherpa, modelPath, detection, hot)

  // Parse the WAV in JS into an in-cage Float32Array and feed acceptWaveform directly.
  // We deliberately avoid the native readWave: under Electron's V8 memory cage the external
  // (C++-allocated) buffer it returns is rejected with "External buffers are not allowed".
  const wave = parseWavPcm16(wavBuffer)
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
  recognizer.decode(stream)
  const result = recognizer.getResult(stream)
  return { text: (result?.text || '').trim() }
}
