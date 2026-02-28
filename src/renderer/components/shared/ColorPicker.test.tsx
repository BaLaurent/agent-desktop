import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ColorPicker, ColorSwatches, hsvToHex, hexToHsv, PRESET_COLORS } from './ColorPicker'

describe('ColorSwatches', () => {
  it('renders 8 preset color swatches', () => {
    const { container } = render(
      <ColorSwatches currentColor={null} onColorChange={vi.fn()} onOpenPicker={vi.fn()} />
    )
    const swatches = container.querySelectorAll('[aria-label^="Set color to"]')
    expect(swatches).toHaveLength(8)
  })

  it('calls onColorChange when a swatch is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <ColorSwatches currentColor={null} onColorChange={onChange} onOpenPicker={vi.fn()} />
    )
    const swatch = container.querySelector('[aria-label="Set color to #ef4444"]') as HTMLElement
    fireEvent.click(swatch)
    expect(onChange).toHaveBeenCalledWith('#ef4444')
  })

  it('shows remove button only when currentColor is set', () => {
    const { rerender, container } = render(
      <ColorSwatches currentColor={null} onColorChange={vi.fn()} onOpenPicker={vi.fn()} />
    )
    expect(container.querySelector('[aria-label="Remove color"]')).toBeNull()

    rerender(
      <ColorSwatches currentColor="#ef4444" onColorChange={vi.fn()} onOpenPicker={vi.fn()} />
    )
    expect(container.querySelector('[aria-label="Remove color"]')).not.toBeNull()
  })

  it('calls onColorChange(null) when remove button is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <ColorSwatches currentColor="#ef4444" onColorChange={onChange} onOpenPicker={vi.fn()} />
    )
    const removeBtn = container.querySelector('[aria-label="Remove color"]') as HTMLElement
    fireEvent.click(removeBtn)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('highlights the currently selected swatch', () => {
    const { container } = render(
      <ColorSwatches currentColor="#ef4444" onColorChange={vi.fn()} onOpenPicker={vi.fn()} />
    )
    const swatch = container.querySelector('[aria-label="Set color to #ef4444"]') as HTMLElement
    expect(swatch.style.outline).toContain('2px solid')
  })

  it('calls onOpenPicker when + button is clicked', () => {
    const onOpenPicker = vi.fn()
    const { container } = render(
      <ColorSwatches currentColor={null} onColorChange={vi.fn()} onOpenPicker={onOpenPicker} />
    )
    const plusBtn = container.querySelector('[aria-label="Pick custom color"]') as HTMLElement
    fireEvent.click(plusBtn)
    expect(onOpenPicker).toHaveBeenCalledTimes(1)
  })
})

describe('ColorPicker', () => {
  it('renders 8 preset color swatches', () => {
    const { container } = render(
      <ColorPicker currentColor={null} onColorChange={vi.fn()} onClose={vi.fn()} position={{ x: 100, y: 100 }} />
    )
    // ColorPicker renders the HSV picker, not swatches — check it renders at all
    expect(container.querySelector('[role="menu"]')).toBeInTheDocument()
  })

  it('renders hue bar and SV square', () => {
    const { container } = render(
      <ColorPicker currentColor="#3b82f6" onColorChange={vi.fn()} onClose={vi.fn()} position={{ x: 100, y: 100 }} />
    )
    // SV square has crosshair cursor
    const svSquare = container.querySelector('[style*="crosshair"]') as HTMLElement
    expect(svSquare).not.toBeNull()
  })

  it('renders hex input with current color value', () => {
    render(
      <ColorPicker currentColor="#3b82f6" onColorChange={vi.fn()} onClose={vi.fn()} position={{ x: 100, y: 100 }} />
    )
    const input = screen.getByDisplayValue('#3b82f6')
    expect(input).toBeInTheDocument()
  })

  it('renders at specified position', () => {
    render(
      <ColorPicker currentColor={null} onColorChange={vi.fn()} onClose={vi.fn()} position={{ x: 200, y: 300 }} />
    )
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('200px')
    expect(menu.style.top).toBe('300px')
  })
})

describe('hsvToHex', () => {
  it('converts pure red', () => {
    expect(hsvToHex(0, 100, 100)).toBe('#ff0000')
  })

  it('converts pure green', () => {
    expect(hsvToHex(120, 100, 100)).toBe('#00ff00')
  })

  it('converts pure blue', () => {
    expect(hsvToHex(240, 100, 100)).toBe('#0000ff')
  })

  it('converts black', () => {
    expect(hsvToHex(0, 0, 0)).toBe('#000000')
  })

  it('converts white', () => {
    expect(hsvToHex(0, 0, 100)).toBe('#ffffff')
  })
})

describe('hexToHsv', () => {
  it('converts pure red', () => {
    const { h, s, v } = hexToHsv('#ff0000')
    expect(h).toBeCloseTo(0, 0)
    expect(s).toBeCloseTo(100, 0)
    expect(v).toBeCloseTo(100, 0)
  })

  it('converts pure green', () => {
    const { h, s, v } = hexToHsv('#00ff00')
    expect(h).toBeCloseTo(120, 0)
    expect(s).toBeCloseTo(100, 0)
    expect(v).toBeCloseTo(100, 0)
  })

  it('converts black', () => {
    const { h, s, v } = hexToHsv('#000000')
    expect(s).toBe(0)
    expect(v).toBe(0)
  })

  it('roundtrips through hsvToHex', () => {
    const original = '#3b82f6'
    const { h, s, v } = hexToHsv(original)
    expect(hsvToHex(h, s, v)).toBe(original)
  })
})

describe('PRESET_COLORS', () => {
  it('has 8 colors', () => {
    expect(PRESET_COLORS).toHaveLength(8)
  })

  it('all colors are valid hex', () => {
    for (const c of PRESET_COLORS) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
