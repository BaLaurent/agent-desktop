import { describe, it, expect, vi } from 'vitest'
import { safeJsonParse } from './json'

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
  })

  it('parses valid JSON array', () => {
    expect(safeJsonParse('["a","b"]', [])).toEqual(['a', 'b'])
  })

  it('returns fallback for null', () => {
    expect(safeJsonParse(null, { default: true })).toEqual({ default: true })
  })

  it('returns fallback for undefined', () => {
    expect(safeJsonParse(undefined, 'fallback')).toBe('fallback')
  })

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', [])).toEqual([])
  })

  it('returns fallback for invalid JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(safeJsonParse('{invalid', {})).toEqual({})
    expect(warnSpy).toHaveBeenCalledOnce()
    warnSpy.mockRestore()
  })

  it('logs truncated content on parse failure', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const longInvalid = 'x'.repeat(200)
    safeJsonParse(longInvalid, null)
    expect(warnSpy).toHaveBeenCalledWith('[json] Failed to parse:', longInvalid.slice(0, 100))
    warnSpy.mockRestore()
  })

  it('preserves generic type', () => {
    const result = safeJsonParse<string[]>('["hello"]', [])
    expect(result).toEqual(['hello'])
  })
})
