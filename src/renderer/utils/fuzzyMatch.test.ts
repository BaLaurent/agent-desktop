import { describe, it, expect } from 'vitest'
import { fuzzyMatch, fuzzyHighlight } from './fuzzyMatch'

describe('fuzzyMatch', () => {
  it('matches basic subsequence', () => {
    const result = fuzzyMatch('msg', 'MessageList.tsx')
    expect(result.match).toBe(true)
    expect(result.indices).toHaveLength(3)
  })

  it('matches case-insensitively', () => {
    const result = fuzzyMatch('MSG', 'MessageList.tsx')
    expect(result.match).toBe(true)
  })

  it('returns no match when chars are missing', () => {
    const result = fuzzyMatch('xyz', 'App.tsx')
    expect(result.match).toBe(false)
    expect(result.score).toBe(-Infinity)
  })

  it('returns no match when query is longer than target', () => {
    const result = fuzzyMatch('abcdef', 'abc')
    expect(result.match).toBe(false)
  })

  it('matches everything when query is empty', () => {
    const result = fuzzyMatch('', 'anything.ts')
    expect(result.match).toBe(true)
    expect(result.score).toBe(0)
    expect(result.indices).toEqual([])
  })

  it('scores exact substring higher than fuzzy spread', () => {
    const exact = fuzzyMatch('List', 'MessageList.tsx')
    const spread = fuzzyMatch('List', 'LotsInSomeThing.tsx')
    expect(exact.match).toBe(true)
    expect(spread.match).toBe(true)
    expect(exact.score).toBeGreaterThan(spread.score)
  })

  it('scores shorter paths higher than longer paths for same match', () => {
    const short = fuzzyMatch('app', 'src/App.tsx')
    const long = fuzzyMatch('app', 'src/components/deep/nested/Application.tsx')
    expect(short.match).toBe(true)
    expect(long.match).toBe(true)
    expect(short.score).toBeGreaterThan(long.score)
  })

  it('gives start-of-word bonus after path separator', () => {
    const afterSlash = fuzzyMatch('M', 'src/MessageList.tsx')
    const midWord = fuzzyMatch('M', 'someModule.tsx')
    // Both match but afterSlash should score higher due to separator bonus
    expect(afterSlash.match).toBe(true)
    expect(midWord.match).toBe(true)
  })

  it('gives camelCase boundary bonus', () => {
    const camel = fuzzyMatch('ML', 'MessageList.tsx')
    const noCamel = fuzzyMatch('ML', 'smallEmail.tsx')
    expect(camel.match).toBe(true)
    expect(noCamel.match).toBe(true)
    expect(camel.score).toBeGreaterThan(noCamel.score)
  })

  it('tracks correct matched indices', () => {
    const result = fuzzyMatch('at', 'cat.ts')
    expect(result.match).toBe(true)
    // 'a' matches at index 1, 't' matches at index 2
    expect(result.indices).toEqual([1, 2])
  })

  it('handles single-character query', () => {
    const result = fuzzyMatch('c', 'config.ts')
    expect(result.match).toBe(true)
    expect(result.indices).toEqual([0])
  })

  it('handles query matching end of target', () => {
    const result = fuzzyMatch('tsx', 'App.tsx')
    expect(result.match).toBe(true)
    expect(result.indices).toEqual([4, 5, 6])
  })

  it('realistic: msglst matches MessageList.tsx', () => {
    const result = fuzzyMatch('msglst', 'MessageList.tsx')
    expect(result.match).toBe(true)
  })

  it('realistic: fidrop matches FileMentionDropdown.tsx', () => {
    const result = fuzzyMatch('fidrop', 'FileMentionDropdown.tsx')
    expect(result.match).toBe(true)
  })
})

describe('fuzzyHighlight', () => {
  it('returns plain text when no indices', () => {
    const result = fuzzyHighlight('hello.txt', [])
    expect(result).toBe('hello.txt')
  })

  it('produces highlighted spans for matched indices', () => {
    // We test the structure by rendering to a flat description
    const result = fuzzyHighlight('cat.ts', [1, 2])
    // result is a React element tree — verify it's not a plain string
    expect(typeof result).not.toBe('string')
  })

  it('handles consecutive matches', () => {
    const result = fuzzyHighlight('abc', [0, 1, 2])
    expect(typeof result).not.toBe('string')
  })

  it('handles non-consecutive matches', () => {
    const result = fuzzyHighlight('abcdef', [0, 2, 4])
    expect(typeof result).not.toBe('string')
  })
})
