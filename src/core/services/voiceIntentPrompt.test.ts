import { describe, it, expect } from 'vitest'
import { DEFAULT_INTENT_PROMPT, buildIntentPrompt, draftToStored } from './voiceIntentPrompt'

describe('buildIntentPrompt', () => {
  it('substitutes {utterance} and all {agent_name} occurrences in one pass', () => {
    const out = buildIntentPrompt('Hi {agent_name}, did you say "{utterance}" to {agent_name}?', {
      utterance: 'what time is it',
      agent_name: 'Clawd',
    })
    expect(out).toBe('Hi Clawd, did you say "what time is it" to Clawd?')
  })

  it('is $-safe: replacement values containing $ patterns are inserted literally', () => {
    const out = buildIntentPrompt('name={agent_name}', { agent_name: 'A$&B$1C' })
    expect(out).toBe('name=A$&B$1C')
  })

  it('does not re-interpret tokens that appear inside an injected value', () => {
    const out = buildIntentPrompt('say "{utterance}"', { utterance: '{agent_name}' })
    expect(out).toBe('say "{agent_name}"')
  })

  it('leaves unknown tokens untouched', () => {
    const out = buildIntentPrompt('{utterance} {unknown}', { utterance: 'hi' })
    expect(out).toBe('hi {unknown}')
  })

  it('the default prompt contains both placeholders', () => {
    expect(DEFAULT_INTENT_PROMPT).toContain('{utterance}')
    expect(DEFAULT_INTENT_PROMPT).toContain('{agent_name}')
  })
})

describe('draftToStored', () => {
  it('returns empty string when the draft equals the default (preserves inheritance)', () => {
    expect(draftToStored(DEFAULT_INTENT_PROMPT)).toBe('')
  })

  it('returns the draft verbatim when it differs from the default', () => {
    expect(draftToStored('my custom prompt {utterance}')).toBe('my custom prompt {utterance}')
  })
})
