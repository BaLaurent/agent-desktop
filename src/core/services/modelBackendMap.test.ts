import { describe, it, expect } from 'vitest'
import {
  detectModelFamily,
  detectBackendConvention,
  parseLastModelByBackend,
  mapModelToBackend,
} from './modelBackendMap'
import { DEFAULT_MODEL, HAIKU_MODEL } from '../types/constants'

describe('detectModelFamily', () => {
  it('detects family from a PI provider-prefixed id (reported case)', () => {
    expect(detectModelFamily('anthropic/claude-3-5-haiku')).toBe('haiku')
  })

  it('detects family from nested provider prefixes', () => {
    expect(detectModelFamily('openrouter/anthropic/claude-sonnet-4-5')).toBe('sonnet')
    expect(detectModelFamily('anthropic/claude-opus-4-1')).toBe('opus')
  })

  it('detects family from bare Claude ids', () => {
    expect(detectModelFamily('claude-haiku-4-5-20251001')).toBe('haiku')
    expect(detectModelFamily(DEFAULT_MODEL)).toBe('sonnet')
  })

  it('returns null for non-Anthropic / custom ids', () => {
    expect(detectModelFamily('openai/gpt-4o')).toBeNull()
    expect(detectModelFamily('my-custom-endpoint')).toBeNull()
  })
})

describe('detectBackendConvention', () => {
  it('classifies PI (slash), Claude (bare claude-), and unknown', () => {
    expect(detectBackendConvention('anthropic/claude-3-5-haiku')).toBe('pi')
    expect(detectBackendConvention('claude-sonnet-4-6')).toBe('claude-agent-sdk')
    expect(detectBackendConvention('gpt-4o-mini')).toBe('unknown')
    expect(detectBackendConvention('')).toBe('unknown')
  })
})

describe('parseLastModelByBackend', () => {
  it('parses a valid object and drops non-string/empty values', () => {
    const json = JSON.stringify({ 'claude-agent-sdk': 'claude-opus-4-7', pi: '', x: 3 })
    expect(parseLastModelByBackend(json)).toEqual({ 'claude-agent-sdk': 'claude-opus-4-7' })
  })

  it('returns {} for undefined, malformed, or array input', () => {
    expect(parseLastModelByBackend(undefined)).toEqual({})
    expect(parseLastModelByBackend('not json')).toEqual({})
    expect(parseLastModelByBackend('[1,2]')).toEqual({})
  })
})

describe('mapModelToBackend', () => {
  it('maps a PI Haiku id to the Claude Haiku model (reported bug)', () => {
    expect(mapModelToBackend('anthropic/claude-3-5-haiku', 'claude-agent-sdk', {})).toBe(HAIKU_MODEL)
  })

  it('maps PI Sonnet/Opus to Claude family equivalents', () => {
    expect(mapModelToBackend('anthropic/claude-sonnet-4-5', 'claude-agent-sdk', {})).toBe(DEFAULT_MODEL)
    expect(mapModelToBackend('anthropic/claude-opus-4-1', 'claude-agent-sdk', {})).toBe('claude-opus-4-7')
  })

  it('is idempotent when the id is already native to the target backend', () => {
    expect(mapModelToBackend('claude-sonnet-4-6', 'claude-agent-sdk', {})).toBe('claude-sonnet-4-6')
    expect(mapModelToBackend('anthropic/claude-3-5-haiku', 'pi', {})).toBe('anthropic/claude-3-5-haiku')
  })

  it('falls back to last Claude selection for a non-mappable PI model', () => {
    expect(mapModelToBackend('openai/gpt-4o', 'claude-agent-sdk', {})).toBe(DEFAULT_MODEL)
    expect(
      mapModelToBackend('openai/gpt-4o', 'claude-agent-sdk', {
        lastModelByBackend: { 'claude-agent-sdk': 'claude-opus-4-7' },
      }),
    ).toBe('claude-opus-4-7')
  })

  it('does NOT mis-map a non-Anthropic PI model that merely contains a family word', () => {
    // "mistral-opus-research" contains "opus" but is not Claude → must
    // fall back, not become claude-opus-4-7.
    expect(mapModelToBackend('mistral/mistral-opus-research', 'claude-agent-sdk', {})).toBe(DEFAULT_MODEL)
    expect(
      mapModelToBackend('mistral/mistral-opus-research', 'claude-agent-sdk', {
        lastModelByBackend: { 'claude-agent-sdk': 'claude-opus-4-7' },
      }),
    ).toBe('claude-opus-4-7')
  })

  it('leaves custom / sentinel / empty ids untouched', () => {
    expect(mapModelToBackend('custom', 'claude-agent-sdk', {})).toBe('custom')
    expect(mapModelToBackend('', 'claude-agent-sdk', {})).toBe('')
    expect(mapModelToBackend(undefined, 'claude-agent-sdk', {})).toBeUndefined()
    expect(mapModelToBackend('my-private-endpoint', 'pi', {})).toBe('my-private-endpoint')
  })

  it('Claude→PI is best-effort: bare id passes through, last PI selection preferred', () => {
    expect(mapModelToBackend('claude-sonnet-4-6', 'pi', {})).toBe('claude-sonnet-4-6')
    expect(
      mapModelToBackend('claude-sonnet-4-6', 'pi', {
        lastModelByBackend: { pi: 'anthropic/claude-sonnet-4-5' },
      }),
    ).toBe('anthropic/claude-sonnet-4-5')
  })
})
