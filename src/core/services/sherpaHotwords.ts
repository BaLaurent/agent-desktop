import * as fs from 'fs/promises'
import * as path from 'path'

/** SentencePiece word-boundary marker (U+2581). */
const WORD_START = '▁'

const SENSITIVITY_SCORES: Record<string, number> = { soft: 2.0, normal: 4.0, strong: 6.0 }

/**
 * Read tokens.txt and collect the valid piece strings. Each line is `<piece> <id>`;
 * pieces never contain whitespace (spaces are encoded as ▁), so we strip the trailing id.
 */
export async function loadTokenPieces(tokensPath: string): Promise<Set<string>> {
  const raw = await fs.readFile(tokensPath, 'utf8')
  const pieces = new Set<string>()
  for (const line of raw.split('\n')) {
    const piece = line.replace(/\s+\d+\s*$/, '')
    if (piece) pieces.add(piece)
  }
  return pieces
}

/**
 * Split a word/phrase into space-separated model pieces, ▁-prefixing each word start,
 * via greedy longest-match against `pieces`. Returns null if any character is unencodable.
 */
export function tokenizeEntry(text: string, pieces: Set<string>): string | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const out: string[] = []
  for (const word of words) {
    let rest = WORD_START + word
    while (rest.length > 0) {
      let matched: string | null = null
      for (let len = rest.length; len > 0; len--) {
        const cand = rest.slice(0, len)
        if (pieces.has(cand)) {
          matched = cand
          break
        }
      }
      if (matched === null) return null
      out.push(matched)
      rest = rest.slice(matched.length)
    }
  }
  return out.join(' ')
}

/** Resolve the hotwords-score from the sensitivity preset, with an optional numeric override. */
export function resolveScore(sensitivity: string, override: string): number {
  const o = Number(override)
  if (override.trim() !== '' && Number.isFinite(o) && o > 0) return o
  return SENSITIVITY_SCORES[sensitivity] ?? SENSITIVITY_SCORES.normal
}

export interface HotwordsBuild {
  content: string
  modelingUnit?: string
  bpeVocabPath?: string
  skipped: string[]
}

/**
 * Build the hotwords file body for a model folder. Hybrid strategy:
 * - if a dedicated bpe.vocab is present → official path: plain-text entries + modeling unit.
 * - otherwise → fallback: self-tokenize each entry against tokens.txt pieces.
 */
export function buildHotwords(args: {
  modelDir: string
  fileNames: string[]
  lexicon: string[]
  pieces: Set<string>
}): HotwordsBuild {
  const { modelDir, fileNames, lexicon, pieces } = args
  const entries = lexicon.map((s) => s.trim()).filter(Boolean)

  const bpeVocab = fileNames.find((f) => f === 'bpe.vocab' || /\.bpe\.vocab$/i.test(f))
  if (bpeVocab) {
    return {
      content: entries.length ? entries.join('\n') + '\n' : '',
      modelingUnit: 'cjkchar+bpe',
      bpeVocabPath: path.join(modelDir, bpeVocab),
      skipped: [],
    }
  }

  const lines: string[] = []
  const skipped: string[] = []
  for (const entry of entries) {
    const tok = tokenizeEntry(entry, pieces)
    if (tok) lines.push(tok)
    else skipped.push(entry)
  }
  return { content: lines.length ? lines.join('\n') + '\n' : '', skipped }
}
