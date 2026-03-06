const ANSI_RE = /\x1b\[([0-9;]*)m/g

const COLORS_16 = [
  '#000000', '#cc0000', '#00cc00', '#cccc00', '#0000cc', '#cc00cc', '#00cccc', '#cccccc',
  '#555555', '#ff0000', '#00ff00', '#ffff00', '#5555ff', '#ff00ff', '#00ffff', '#ffffff',
]

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function color256(n: number): string {
  if (n < 16) return COLORS_16[n]
  if (n >= 232) { const v = (n - 232) * 10 + 8; return `rgb(${v},${v},${v})` }
  const idx = n - 16
  const r = Math.floor(idx / 36) * 51
  const g = Math.floor((idx % 36) / 6) * 51
  const b = (idx % 6) * 51
  return `rgb(${r},${g},${b})`
}

export function ansiToHtml(text: string): string {
  const parts: string[] = []
  const activeStyles = new Map<string, string>()
  let lastIndex = 0

  for (const match of text.matchAll(ANSI_RE)) {
    const before = text.slice(lastIndex, match.index)
    if (before) parts.push(wrapWithStyles(escapeHtml(before), activeStyles))
    lastIndex = match.index! + match[0].length

    const codes = match[1] ? match[1].split(';').map(Number) : [0]
    let i = 0
    while (i < codes.length) {
      const c = codes[i]
      if (c === 0) activeStyles.clear()
      else if (c === 1) activeStyles.set('font-weight', 'bold')
      else if (c === 2) activeStyles.set('opacity', '0.6')
      else if (c === 3) activeStyles.set('font-style', 'italic')
      else if (c === 4) activeStyles.set('text-decoration', 'underline')
      else if (c >= 30 && c <= 37) activeStyles.set('color', COLORS_16[c - 30])
      else if (c >= 90 && c <= 97) activeStyles.set('color', COLORS_16[c - 82])
      else if (c >= 40 && c <= 47) activeStyles.set('background', COLORS_16[c - 40])
      else if (c >= 100 && c <= 107) activeStyles.set('background', COLORS_16[c - 92])
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        activeStyles.set(c === 38 ? 'color' : 'background', color256(codes[i + 2] || 0))
        i += 2
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const prop = c === 38 ? 'color' : 'background'
        activeStyles.set(prop, `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`)
        i += 4
      }
      i++
    }
  }

  const remaining = text.slice(lastIndex)
  if (remaining) parts.push(wrapWithStyles(escapeHtml(remaining), activeStyles))

  return parts.join('') || '&nbsp;'
}

function wrapWithStyles(html: string, styles: Map<string, string>): string {
  if (styles.size === 0) return html
  const styleStr = Array.from(styles).map(([k, v]) => `${k}:${v}`).join(';')
  return `<span style="${styleStr}">${html}</span>`
}

export function ansiLinesToHtml(lines: string[]): string {
  return lines.map(line => `<div>${ansiToHtml(line)}</div>`).join('')
}
