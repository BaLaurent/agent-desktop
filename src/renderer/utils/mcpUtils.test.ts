import { describe, it, expect } from 'vitest'
import { parseMcpDisabledList } from './mcpUtils'

describe('parseMcpDisabledList', () => {
  it('returns empty array for undefined', () => {
    expect(parseMcpDisabledList(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseMcpDisabledList('')).toEqual([])
  })

  it('parses valid JSON array of strings', () => {
    expect(parseMcpDisabledList('["server-a","server-b"]')).toEqual(['server-a', 'server-b'])
  })

  it('returns empty array for empty JSON array', () => {
    expect(parseMcpDisabledList('[]')).toEqual([])
  })

  it('returns empty array for non-array JSON', () => {
    expect(parseMcpDisabledList('"just a string"')).toEqual([])
    expect(parseMcpDisabledList('42')).toEqual([])
    expect(parseMcpDisabledList('{"key":"val"}')).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseMcpDisabledList('not json')).toEqual([])
    expect(parseMcpDisabledList('[')).toEqual([])
  })
})
