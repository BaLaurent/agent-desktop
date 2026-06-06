import { describe, it, expect } from 'vitest'
import { stripWakeword } from './stripWakeword'

describe('stripWakeword', () => {
  it('removes a clean leading wakeword', () => {
    expect(stripWakeword('hey clawd what is the weather', 'hey clawd')).toEqual({
      text: 'what is the weather',
      stripped: true,
    })
  })

  it('is case- and punctuation-insensitive', () => {
    expect(stripWakeword('Hey, Clawd! turn on the lights', 'hey clawd')).toEqual({
      text: 'turn on the lights',
      stripped: true,
    })
  })

  it('leaves text unchanged when the wakeword is absent (STT dropped it)', () => {
    expect(stripWakeword('what is the weather', 'hey clawd')).toEqual({
      text: 'what is the weather',
      stripped: false,
    })
  })

  it('does not strip a wakeword that appears mid-sentence', () => {
    expect(stripWakeword('I told her hey clawd is great', 'hey clawd')).toEqual({
      text: 'I told her hey clawd is great',
      stripped: false,
    })
  })

  it('returns empty text when only the wakeword was spoken', () => {
    expect(stripWakeword('hey clawd', 'hey clawd')).toEqual({ text: '', stripped: true })
  })

  it('treats an empty wakeword as no-op', () => {
    expect(stripWakeword('anything here', '')).toEqual({ text: 'anything here', stripped: false })
  })
})
