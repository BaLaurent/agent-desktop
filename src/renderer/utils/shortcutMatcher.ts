export interface ParsedShortcut {
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  key: string
}

export function parseAccelerator(accel: string): ParsedShortcut {
  const parts = accel.split('+')
  let ctrl = false
  let meta = false
  let shift = false
  let alt = false
  let key = ''

  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'commandorcontrol' || lower === 'ctrl' || lower === 'control') {
      ctrl = true
    } else if (lower === 'super' || lower === 'meta' || lower === 'command' || lower === 'cmd') {
      meta = true
    } else if (lower === 'shift') {
      shift = true
    } else if (lower === 'alt' || lower === 'option') {
      alt = true
    } else {
      key = part.toLowerCase()
    }
  }

  // Standalone keys like "Escape", "Enter" have no modifiers
  if (!key && parts.length === 1) {
    key = parts[0].toLowerCase()
  }

  return { ctrl, meta, shift, alt, key }
}

/** Normalise event.key to a canonical lowercase name for comparison with parseAccelerator output. */
function normalizeEventKey(key: string): string {
  // macOS Option+Space fires '\u00A0' (non-breaking space); treat as regular space
  if (key === ' ' || key === '\u00A0') return 'space'
  return key.toLowerCase()
}

export function matchesEvent(event: KeyboardEvent, parsed: ParsedShortcut): boolean {
  const ctrlMatch = event.ctrlKey === parsed.ctrl
  const metaMatch = event.metaKey === parsed.meta
  const shiftMatch = event.shiftKey === parsed.shift
  const altMatch = event.altKey === parsed.alt
  const keyMatch = normalizeEventKey(event.key) === parsed.key

  return ctrlMatch && metaMatch && shiftMatch && altMatch && keyMatch
}

/** Convert stored accelerator string to user-friendly display label. */
export function formatKeybinding(accel: string): string {
  return accel
    .split('+')
    .map((part) => {
      if (part.toLowerCase() === 'commandorcontrol') return 'Ctrl'
      return part
    })
    .join('+')
}
