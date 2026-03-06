import { describe, it, expect } from 'vitest'
import { ansiToHtml, ansiLinesToHtml } from './ansiToHtml'

describe('ansiToHtml', () => {
  it('returns plain text unchanged (escaped)', () => {
    expect(ansiToHtml('hello world')).toBe('hello world')
  })

  it('escapes HTML entities', () => {
    expect(ansiToHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;')
  })

  it('converts bold (SGR 1)', () => {
    expect(ansiToHtml('\x1b[1mBold\x1b[0m')).toBe(
      '<span style="font-weight:bold">Bold</span>'
    )
  })

  it('converts dim (SGR 2)', () => {
    expect(ansiToHtml('\x1b[2mDim\x1b[0m')).toBe(
      '<span style="opacity:0.6">Dim</span>'
    )
  })

  it('converts italic (SGR 3)', () => {
    expect(ansiToHtml('\x1b[3mItalic\x1b[0m')).toBe(
      '<span style="font-style:italic">Italic</span>'
    )
  })

  it('converts standard foreground color (SGR 31 = red)', () => {
    expect(ansiToHtml('\x1b[31mRed\x1b[0m')).toBe(
      '<span style="color:#cc0000">Red</span>'
    )
  })

  it('converts bright foreground color (SGR 92 = bright green)', () => {
    expect(ansiToHtml('\x1b[92mGreen\x1b[0m')).toBe(
      '<span style="color:#00ff00">Green</span>'
    )
  })

  it('converts 256-color foreground (38;5;N)', () => {
    const result = ansiToHtml('\x1b[38;5;196mRed256\x1b[0m')
    expect(result).toContain('color:')
    expect(result).toContain('Red256')
  })

  it('converts RGB foreground (38;2;R;G;B)', () => {
    expect(ansiToHtml('\x1b[38;2;255;128;0mOrange\x1b[0m')).toBe(
      '<span style="color:rgb(255,128,0)">Orange</span>'
    )
  })

  it('accumulates styles across escape sequences', () => {
    const result = ansiToHtml('\x1b[1m\x1b[31mBoldRed\x1b[0m')
    expect(result).toContain('font-weight:bold')
    expect(result).toContain('color:#cc0000')
    expect(result).toContain('BoldRed')
  })

  it('resets all styles on SGR 0', () => {
    const result = ansiToHtml('\x1b[1mBold\x1b[0m Normal')
    expect(result).toBe('<span style="font-weight:bold">Bold</span> Normal')
  })

  it('returns &nbsp; for empty string', () => {
    expect(ansiToHtml('')).toBe('&nbsp;')
  })
})

describe('ansiLinesToHtml', () => {
  it('wraps each line in a div', () => {
    const result = ansiLinesToHtml(['line1', 'line2'])
    expect(result).toBe('<div>line1</div><div>line2</div>')
  })

  it('preserves ANSI conversion within lines', () => {
    const result = ansiLinesToHtml(['\x1b[1mBold\x1b[0m'])
    expect(result).toContain('<span style="font-weight:bold">Bold</span>')
  })
})
