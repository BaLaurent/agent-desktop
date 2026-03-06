import { describe, it, expect } from 'vitest'
import { keyEventToTerminal } from './keyToTerminal'

function fakeKey(key: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods } as KeyboardEvent
}

describe('keyEventToTerminal', () => {
  it('maps Enter to \\r', () => {
    expect(keyEventToTerminal(fakeKey('Enter'))).toBe('\r')
  })

  it('maps Escape to \\x1b', () => {
    expect(keyEventToTerminal(fakeKey('Escape'))).toBe('\x1b')
  })

  it('maps Tab to \\t', () => {
    expect(keyEventToTerminal(fakeKey('Tab'))).toBe('\t')
  })

  it('maps Shift+Tab to \\x1b[Z', () => {
    expect(keyEventToTerminal(fakeKey('Tab', { shiftKey: true }))).toBe('\x1b[Z')
  })

  it('maps ArrowUp to \\x1b[A', () => {
    expect(keyEventToTerminal(fakeKey('ArrowUp'))).toBe('\x1b[A')
  })

  it('maps ArrowDown to \\x1b[B', () => {
    expect(keyEventToTerminal(fakeKey('ArrowDown'))).toBe('\x1b[B')
  })

  it('maps Space to literal space', () => {
    expect(keyEventToTerminal(fakeKey(' '))).toBe(' ')
  })

  it('maps Ctrl+C to \\x03', () => {
    expect(keyEventToTerminal(fakeKey('c', { ctrlKey: true }))).toBe('\x03')
  })

  it('maps printable characters to themselves', () => {
    expect(keyEventToTerminal(fakeKey('a'))).toBe('a')
    expect(keyEventToTerminal(fakeKey('5'))).toBe('5')
  })

  it('maps Backspace to \\x7f', () => {
    expect(keyEventToTerminal(fakeKey('Backspace'))).toBe('\x7f')
  })

  it('returns null for unhandled keys', () => {
    expect(keyEventToTerminal(fakeKey('F12'))).toBeNull()
    expect(keyEventToTerminal(fakeKey('Shift'))).toBeNull()
    expect(keyEventToTerminal(fakeKey('Control'))).toBeNull()
  })
})
