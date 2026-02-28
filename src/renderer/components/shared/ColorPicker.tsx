import { useState, useRef, useEffect, useCallback } from 'react'
import { ContextMenu } from './ContextMenu'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
]

function hsvToHex(h: number, s: number, v: number): string {
  const s1 = s / 100, v1 = v / 100
  const c = v1 * s1
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v1 - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

export { PRESET_COLORS, hsvToHex, hexToHsv }

interface SwatchesProps {
  currentColor: string | null
  onColorChange: (color: string | null) => void
  onOpenPicker: () => void
}

export function ColorSwatches({ currentColor, onColorChange, onOpenPicker }: SwatchesProps) {
  return (
    <div className="px-3 py-1.5 mobile:py-2.5">
      <div className="text-xs mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Color</div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onColorChange(c)}
            className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-110"
            style={{
              backgroundColor: c,
              outline: currentColor === c ? '2px solid var(--color-text)' : 'none',
              outlineOffset: '1px',
            }}
            aria-label={`Set color to ${c}`}
          />
        ))}
        <button
          onClick={onOpenPicker}
          className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-110 flex items-center justify-center text-xs"
          style={{
            border: '1px dashed var(--color-text-muted)',
            color: 'var(--color-text-muted)',
          }}
          title="Custom color"
          aria-label="Pick custom color"
        >
          +
        </button>
        {currentColor && (
          <button
            onClick={() => onColorChange(null)}
            className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-125 flex items-center justify-center text-xs font-bold"
            style={{
              color: 'var(--color-text)',
              border: '1px solid var(--color-text-muted)',
            }}
            title="Remove color"
            aria-label="Remove color"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  )
}

interface ColorPickerProps {
  currentColor: string | null
  onColorChange: (color: string | null) => void
  onClose: () => void
  position: { x: number; y: number }
}

export function ColorPicker({ currentColor, onColorChange, onClose, position }: ColorPickerProps) {
  const [pickerHsv, setPickerHsv] = useState(() => hexToHsv(currentColor || '#3b82f6'))
  const hsvRef = useRef(pickerHsv)
  const hexInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    hsvRef.current = pickerHsv
    if (hexInputRef.current && document.activeElement !== hexInputRef.current) {
      hexInputRef.current.value = hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v)
    }
  }, [pickerHsv])

  const handleClose = useCallback(() => {
    const { h, s, v } = hsvRef.current
    onColorChange(hsvToHex(h, s, v))
    onClose()
  }, [onColorChange, onClose])

  const handleSVMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const update = (ev: { clientX: number; clientY: number }) => {
      const s = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100))
      const v = Math.max(0, Math.min(100, (1 - (ev.clientY - rect.top) / rect.height) * 100))
      setPickerHsv(prev => ({ ...prev, s, v }))
    }
    update(e)
    const onMove = (ev: MouseEvent) => update(ev)
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const handleHueMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const update = (ev: { clientX: number }) => {
      const h = Math.max(0, Math.min(360, ((ev.clientX - rect.left) / rect.width) * 360))
      setPickerHsv(prev => ({ ...prev, h }))
    }
    update(e)
    const onMove = (ev: MouseEvent) => update(ev)
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return (
    <ContextMenu position={position} onClose={handleClose} style={{ width: 220 }}>
      <div className="px-2.5 pb-2.5">
        {/* Saturation-Value square */}
        <div
          style={{
            width: '100%', height: 140, position: 'relative',
            backgroundColor: `hsl(${pickerHsv.h}, 100%, 50%)`,
            borderRadius: 4, cursor: 'crosshair',
          }}
          onMouseDown={handleSVMouseDown}
        >
          <div style={{ position: 'absolute', inset: 0, borderRadius: 4, background: 'linear-gradient(to right, white, transparent)' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: 4, background: 'linear-gradient(to bottom, transparent, black)' }} />
          <div style={{
            position: 'absolute',
            left: `${pickerHsv.s}%`, top: `${100 - pickerHsv.v}%`,
            width: 12, height: 12, borderRadius: '50%',
            border: '2px solid white', boxShadow: '0 0 2px rgba(0,0,0,0.6)',
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }} />
        </div>
        {/* Hue bar */}
        <div
          style={{
            width: '100%', height: 14, marginTop: 8, position: 'relative',
            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            borderRadius: 4, cursor: 'crosshair',
          }}
          onMouseDown={handleHueMouseDown}
        >
          <div style={{
            position: 'absolute',
            left: `${(pickerHsv.h / 360) * 100}%`, top: '50%',
            width: 8, height: 14, borderRadius: 3,
            border: '2px solid white', boxShadow: '0 0 2px rgba(0,0,0,0.6)',
            transform: 'translate(-50%, -50%)', pointerEvents: 'none',
          }} />
        </div>
        {/* Preview swatch + hex input */}
        <div className="flex items-center gap-2 mt-2">
          <div
            style={{
              width: 28, height: 28, borderRadius: 4, flexShrink: 0,
              backgroundColor: hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v),
              border: '1px solid var(--color-text-muted)',
            }}
          />
          <input
            ref={hexInputRef}
            type="text"
            defaultValue={hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v)}
            className="flex-1 px-2 py-1 rounded text-xs font-mono"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-text-muted)',
              outline: 'none',
            }}
            onChange={(e) => {
              const val = e.target.value
              if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                setPickerHsv(hexToHsv(val))
              }
            }}
            maxLength={7}
          />
        </div>
      </div>
    </ContextMenu>
  )
}
