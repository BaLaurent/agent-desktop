import type { ReactNode } from 'react'
import { createElement } from 'react'

export interface FuzzyResult {
  match: boolean
  score: number
  indices: number[] // positions matched in target
}

/**
 * VS Code-style fuzzy matching: each char in query must appear (in order) in target.
 * Scoring rewards consecutive matches, start-of-word hits, and shorter paths.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  if (!query) return { match: true, score: 0, indices: [] }

  const queryLower = query.toLowerCase()
  const targetLower = target.toLowerCase()
  const queryLen = queryLower.length
  const targetLen = targetLower.length

  if (queryLen > targetLen) return { match: false, score: -Infinity, indices: [] }

  // Check if all chars exist in order (fast bail-out)
  const indices: number[] = []
  let ti = 0
  for (let qi = 0; qi < queryLen; qi++) {
    const ch = queryLower[qi]
    let found = false
    while (ti < targetLen) {
      if (targetLower[ti] === ch) {
        indices.push(ti)
        ti++
        found = true
        break
      }
      ti++
    }
    if (!found) return { match: false, score: -Infinity, indices: [] }
  }

  // Scoring
  let score = 0

  // Consecutive match bonus
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i - 1] + 1) {
      score += 5
    }
  }

  // Start-of-word bonus: match at index 0 or after separator (/, ., -, _)
  const separators = new Set(['/', '.', '-', '_'])
  for (const idx of indices) {
    if (idx === 0) {
      score += 10
    } else if (separators.has(target[idx - 1])) {
      score += 8
    } else if (
      target[idx - 1] === target[idx - 1].toLowerCase() &&
      target[idx] === target[idx].toUpperCase() &&
      target[idx] !== target[idx].toLowerCase()
    ) {
      // camelCase boundary: lowercase followed by uppercase
      score += 6
    }
  }

  // Exact substring bonus
  const substringIdx = targetLower.indexOf(queryLower)
  if (substringIdx >= 0) {
    score += 15
    if (substringIdx === 0) score += 5 // prefix match
  }

  // Shorter paths are better (mild penalty)
  score -= targetLen * 0.3

  // Tighter match span is better
  const span = indices[indices.length - 1] - indices[0]
  score -= span * 0.5

  return { match: true, score, indices }
}

/**
 * Renders text with matched characters highlighted.
 */
export function fuzzyHighlight(text: string, indices: number[]): ReactNode {
  if (indices.length === 0) return text

  const indexSet = new Set(indices)
  const parts: ReactNode[] = []
  let i = 0

  while (i < text.length) {
    if (indexSet.has(i)) {
      // Collect consecutive highlighted chars
      let end = i
      while (end < text.length && indexSet.has(end)) end++
      parts.push(
        createElement('span', {
          key: `h${i}`,
          style: { color: 'var(--color-primary)', fontWeight: 600 },
        }, text.slice(i, end))
      )
      i = end
    } else {
      // Collect consecutive non-highlighted chars
      let end = i
      while (end < text.length && !indexSet.has(end)) end++
      parts.push(text.slice(i, end))
      i = end
    }
  }

  return createElement('span', null, ...parts)
}
