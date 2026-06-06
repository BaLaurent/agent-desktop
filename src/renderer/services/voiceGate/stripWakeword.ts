/**
 * Cosmetic leading-strip of the wakeword from a transcript.
 *
 * The wakeword is DETECTED by the hotword engine (audio), not by this function — so this is
 * best-effort cleanup only: if the transcript happens to start with the wakeword tokens, remove
 * them so the AI sees "what's the weather" rather than "hey clawd what's the weather". If the STT
 * dropped or mangled the wakeword, we leave the text untouched (the caller still sends it, because
 * a wake event fired). Matching is token-prefix with light normalization (case, punctuation).
 */

function normalizeToken(tok: string): string {
  return tok.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

export interface StripResult {
  /** Transcript with the leading wakeword removed (or unchanged if no prefix match). */
  text: string
  /** Whether a wakeword prefix was found and removed. */
  stripped: boolean
}

export function stripWakeword(transcript: string, wakeword: string): StripResult {
  const original = transcript.trim()
  const wakeTokens = tokenize(wakeword).map(normalizeToken).filter(Boolean)
  if (wakeTokens.length === 0) return { text: original, stripped: false }

  const rawTokens = tokenize(original)
  if (rawTokens.length < wakeTokens.length) return { text: original, stripped: false }

  for (let i = 0; i < wakeTokens.length; i++) {
    if (normalizeToken(rawTokens[i]) !== wakeTokens[i]) {
      return { text: original, stripped: false }
    }
  }

  // Drop leading punctuation/commas left after the wakeword ("hey clawd, what" → "what").
  const rest = rawTokens.slice(wakeTokens.length).join(' ').replace(/^[\s,.:;!?-]+/, '').trim()
  return { text: rest, stripped: true }
}
