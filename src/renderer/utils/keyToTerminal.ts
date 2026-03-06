export function keyEventToTerminal(e: KeyboardEvent): string | null {
  // Shift+Tab before other Shift combos
  if (e.shiftKey && e.key === 'Tab') return '\x1b[Z'

  // Ctrl combos
  if (e.ctrlKey && !e.altKey && !e.metaKey) {
    if (e.key === 'Enter') return '\x1b[13;5u'
    if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
      return String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64)
    }
  }

  switch (e.key) {
    case 'Enter': return '\r'
    case 'Escape': return '\x1b'
    case 'Tab': return '\t'
    case 'Backspace': return '\x7f'
    case 'ArrowUp': return '\x1b[A'
    case 'ArrowDown': return '\x1b[B'
    case 'ArrowRight': return '\x1b[C'
    case 'ArrowLeft': return '\x1b[D'
    case 'Home': return '\x1b[H'
    case 'End': return '\x1b[F'
    case 'Delete': return '\x1b[3~'
    case 'PageUp': return '\x1b[5~'
    case 'PageDown': return '\x1b[6~'
  }

  // Printable single characters (no modifier keys)
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    return e.key
  }

  return null
}
