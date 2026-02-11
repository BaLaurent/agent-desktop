export interface ParsedShortcut {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

export function parseAccelerator(accel: string): ParsedShortcut {
  const parts = accel.split('+')
  let ctrl = false
  let shift = false
  let alt = false
  let key = ''

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'commandorcontrol' || lower === 'ctrl' || lower === 'command') {
      ctrl = true
    } else if (lower === 'shift') {
      shift = true
    } else if (lower === 'alt') {
      alt = true
    } else {
      key = part.toLowerCase()
    }
  }

  // Standalone keys like "Escape", "Enter" have no modifiers
  if (!key && parts.length === 1) {
    key = parts[0].toLowerCase()
  }

  return { ctrl, shift, alt, key }
}

export function matchesEvent(event: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const ctrlMatch = (event.ctrlKey || event.metaKey) === parsed.ctrl
  const shiftMatch = event.shiftKey === parsed.shift
  const altMatch = event.altKey === parsed.alt
  const keyMatch = event.key.toLowerCase() === parsed.key

  return ctrlMatch && shiftMatch && altMatch && keyMatch
}
