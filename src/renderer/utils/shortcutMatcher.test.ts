import { describe, it, expect } from 'vitest'
import { parseAccelerator, matchesEvent, formatKeybinding } from './shortcutMatcher'

describe('parseAccelerator', () => {
  it('parses CommandOrControl+N', () => {
    const result = parseAccelerator('CommandOrControl+N')
    expect(result).toEqual({ ctrl: true, meta: false, shift: false, alt: false, key: 'n' })
  })

  it('parses Ctrl+Shift+K', () => {
    const result = parseAccelerator('Ctrl+Shift+K')
    expect(result).toEqual({ ctrl: true, meta: false, shift: true, alt: false, key: 'k' })
  })

  it('parses Alt+Z', () => {
    const result = parseAccelerator('Alt+Z')
    expect(result).toEqual({ ctrl: false, meta: false, shift: false, alt: true, key: 'z' })
  })

  it('parses standalone Escape', () => {
    const result = parseAccelerator('Escape')
    expect(result).toEqual({ ctrl: false, meta: false, shift: false, alt: false, key: 'escape' })
  })

  it('parses standalone Enter', () => {
    const result = parseAccelerator('Enter')
    expect(result).toEqual({ ctrl: false, meta: false, shift: false, alt: false, key: 'enter' })
  })

  it('parses Command+, (comma)', () => {
    const result = parseAccelerator('CommandOrControl+,')
    expect(result).toEqual({ ctrl: true, meta: false, shift: false, alt: false, key: ',' })
  })

  it('parses Super+A (meta modifier)', () => {
    const result = parseAccelerator('Super+A')
    expect(result).toEqual({ ctrl: false, meta: true, shift: false, alt: false, key: 'a' })
  })

  it('parses Meta+B (meta modifier)', () => {
    const result = parseAccelerator('Meta+B')
    expect(result).toEqual({ ctrl: false, meta: true, shift: false, alt: false, key: 'b' })
  })

  it('parses Command+C as meta (not ctrl)', () => {
    const result = parseAccelerator('Command+C')
    expect(result).toEqual({ ctrl: false, meta: true, shift: false, alt: false, key: 'c' })
  })

  it('parses Cmd+D as meta', () => {
    const result = parseAccelerator('Cmd+D')
    expect(result).toEqual({ ctrl: false, meta: true, shift: false, alt: false, key: 'd' })
  })

  it('parses Option+Z as alt', () => {
    const result = parseAccelerator('Option+Z')
    expect(result).toEqual({ ctrl: false, meta: false, shift: false, alt: true, key: 'z' })
  })

  it('parses Control+X as ctrl', () => {
    const result = parseAccelerator('Control+X')
    expect(result).toEqual({ ctrl: true, meta: false, shift: false, alt: false, key: 'x' })
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

  it('does not match Ctrl+N with metaKey (Super key is independent)', () => {
    const parsed = parseAccelerator('CommandOrControl+N')
    const event = makeEvent({ key: 'n', metaKey: true })
    expect(matchesEvent(event, parsed)).toBe(false)
  })

  it('matches Super+A with metaKey', () => {
    const parsed = parseAccelerator('Super+A')
    const event = makeEvent({ key: 'a', metaKey: true })
    expect(matchesEvent(event, parsed)).toBe(true)
  })

  it('does not match Super+A with ctrlKey', () => {
    const parsed = parseAccelerator('Super+A')
    const event = makeEvent({ key: 'a', ctrlKey: true })
    expect(matchesEvent(event, parsed)).toBe(false)
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

  it('does not match Escape when Super is pressed', () => {
    const parsed = parseAccelerator('Escape')
    const event = makeEvent({ key: 'Escape', metaKey: true })
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

  it('does not match when extra meta is present', () => {
    const parsed = parseAccelerator('Ctrl+N')
    const event = makeEvent({ key: 'n', ctrlKey: true, metaKey: true })
    expect(matchesEvent(event, parsed)).toBe(false)
  })

  it('matches Alt+Space with event.key = space character', () => {
    const parsed = parseAccelerator('Alt+Space')
    const event = makeEvent({ key: ' ', altKey: true })
    expect(matchesEvent(event, parsed)).toBe(true)
  })

  it('matches Alt+Space with macOS non-breaking space (\\u00A0)', () => {
    const parsed = parseAccelerator('Alt+Space')
    const event = makeEvent({ key: '\u00A0', altKey: true })
    expect(matchesEvent(event, parsed)).toBe(true)
  })

  it('matches standalone Space', () => {
    const parsed = parseAccelerator('Space')
    const event = makeEvent({ key: ' ' })
    expect(matchesEvent(event, parsed)).toBe(true)
  })
})

describe('formatKeybinding', () => {
  it('converts CommandOrControl to Ctrl', () => {
    expect(formatKeybinding('CommandOrControl+N')).toBe('Ctrl+N')
  })

  it('leaves Ctrl as-is', () => {
    expect(formatKeybinding('Ctrl+N')).toBe('Ctrl+N')
  })

  it('leaves Super as-is', () => {
    expect(formatKeybinding('Super+A')).toBe('Super+A')
  })

  it('handles multiple modifiers', () => {
    expect(formatKeybinding('CommandOrControl+Shift+V')).toBe('Ctrl+Shift+V')
  })

  it('handles standalone keys', () => {
    expect(formatKeybinding('Escape')).toBe('Escape')
  })

  it('handles Alt combinations', () => {
    expect(formatKeybinding('Alt+Space')).toBe('Alt+Space')
  })
})
