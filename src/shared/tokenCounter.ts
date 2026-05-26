/**
 * Token counter abstraction.
 *
 * One concrete implementation, {@link LocalTokenizer}: gpt-tokenizer (BPE),
 * fast + offline, ~±10% on Claude text. The {@link TokenCounter} interface
 * stays so callers like {@link countJsonTokens} can take a substitute in tests.
 */

import { encode } from 'gpt-tokenizer'

export interface TokenCounter {
  /** Number of tokens in `text`. Never throws — returns 0 on empty input. */
  count(text: string): number
}

// class consumed by tokenCounter.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export class LocalTokenizer implements TokenCounter {
  count(text: string): number {
    if (!text) return 0
    try {
      return encode(text).length
    } catch {
      // Fallback heuristic if the tokenizer ever chokes on weird input (rare): ~4 chars/token
      return Math.ceil(text.length / 4)
    }
  }
}

export const localTokenizer = new LocalTokenizer()

/** Count tokens of a JSON-serialisable object. Stable ordering isn't needed — we only care about size. */
// consumed by tokenCounter.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export function countJsonTokens(obj: unknown, counter: TokenCounter = localTokenizer): number {
  if (obj == null) return 0
  try {
    return counter.count(JSON.stringify(obj))
  } catch {
    return 0
  }
}
