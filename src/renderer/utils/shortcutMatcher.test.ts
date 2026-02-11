import { describe, it, expect } from 'vitest'
import { parseAccelerator, matchesEvent } from './shortcutMatcher'

describe('parseAccelerator', () => {
  it('parses CommandOrControl+N', () => {
    const result = parseAccelerator('CommandOrControl+N')
    expect(result).toEqual({ ctrl: true, shift: false, alt: false, key: 'n' })
  })

  it('parses Ctrl+Shift+K', () => {
    const result = parseAccelerator('Ctrl+Shift+K')
    expect(result).toEqual({ ctrl: true, shift: true, alt: false, key: 'k' })
  })

  it('parses Alt+Z', () => {
    const result = parseAccelerator('Alt+Z')
    expect(result).toEqual({ ctrl: false, shift: false, alt: true, key: 'z' })
  })

  it('parses standalone Escape', () => {
    const result = parseAccelerator('Escape')
    expect(result).toEqual({ ctrl: false, shift: false, alt: false, key: 'escape' })
  })

  it('parses standalone Enter', () => {
    const result = parseAccelerator('Enter')
    expect(result).toEqual({ ctrl: false, shift: false, alt: false, key: 'enter' })
  })

  it('parses Command+, (comma)', () => {
    const result = parseAccelerator('CommandOrControl+,')
    expect(result).toEqual({ ctrl: true, shift: false, alt: false, key: ',' })
  })

  it('parses Command modifier same as Ctrl', () => {
    const result = parseAccelerator('Command+B')
    expect(result).toEqual({ ctrl: true, shift: false, alt: false, key: 'b' })
  })
})

describe('matchesEvent', () => {
  function makeEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
      key: '',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...overrides,
    } as KeyboardEvent
  }

  it('matches Ctrl+N with ctrlKey', () => {
    const parsed = parseAccelerator('CommandOrControl+N')
    const event = makeEvent({ key: 'n', ctrlKey: true })
    expect(matchesEvent(event, parsed)).toBe(true)
  })

  it('matches Ctrl+N with metaKey (Mac)', () => {
    const parsed = parseAccelerator('CommandOrControl+N')
    const event = makeEvent({ key: 'n', metaKey: true })
    expect(matchesEvent(event, parsed)).toBe(true)
  })

  it('does not match without modifier when modifier expected', () => {
    const parsed = parseAccelerator('CommandOrControl+N')
    const event = makeEvent({ key: 'n' })
    expect(matchesEvent(event, parsed)).toBe(false)
  })

  it('does not match wrong key', () => {
    const parsed = parseAccelerator('CommandOrControl+N')
    const event = makeEvent({ key: 'b', ctrlKey: true })
    expect(matchesEvent(event, parsed)).toBe(false)
  })

  it('matches standalone Escape', () => {
    const parsed = parseAccelerator('Escape')
    const event = makeEvent({ key: 'Escape' })
    expect(matchesEvent(event, parsed)).toBe(true)
  })

  it('does not match Escape when Ctrl is pressed', () => {
    const parsed = parseAccelerator('Escape')
    const event = makeEvent({ key: 'Escape', ctrlKey: true })
    expect(matchesEvent(event, parsed)).toBe(false)
  })

  it('matches case-insensitively', () => {
    const parsed = parseAccelerator('CommandOrControl+B')
    const event = makeEvent({ key: 'B', ctrlKey: true })
    expect(matchesEvent(event, parsed)).toBe(true)
  })

  it('matches Shift modifier', () => {
    const parsed = parseAccelerator('Ctrl+Shift+K')
    const event = makeEvent({ key: 'k', ctrlKey: true, shiftKey: true })
    expect(matchesEvent(event, parsed)).toBe(true)
  })

  it('does not match when extra shift is present', () => {
    const parsed = parseAccelerator('CommandOrControl+N')
    const event = makeEvent({ key: 'n', ctrlKey: true, shiftKey: true })
    expect(matchesEvent(event, parsed)).toBe(false)
  })
})
