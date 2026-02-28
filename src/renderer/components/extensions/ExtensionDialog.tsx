import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react'
import type { PiUIDialog, PiUIResponse } from '../../../shared/piUITypes'

interface ExtensionDialogProps {
  dialog: PiUIDialog
  onRespond: (response: PiUIResponse) => void
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.5)',
}

const cardStyle: CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-text-muted)',
  borderRadius: 8,
  padding: 20,
  maxWidth: 400,
  width: '100%',
}

const titleStyle: CSSProperties = {
  color: 'var(--color-text)',
  margin: '0 0 12px 0',
  fontSize: 16,
  fontWeight: 600,
}

const buttonBaseStyle: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
}

const primaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: 'var(--color-primary)',
  color: 'var(--color-contrast)',
}

const secondaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 4,
  border: '1px solid var(--color-text-muted)',
  background: 'var(--color-base)',
  color: 'var(--color-text)',
  fontSize: 13,
  boxSizing: 'border-box',
}

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 12,
  justifyContent: 'flex-end',
}

export function ExtensionDialog({ dialog, onRespond }: ExtensionDialogProps) {
  const cancel = useCallback(() => {
    onRespond({ id: dialog.id, cancelled: true })
  }, [dialog.id, onRespond])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [cancel])

  return (
    <div style={backdropStyle} data-testid="extension-dialog-backdrop">
      <div style={cardStyle} role="dialog" aria-label={dialog.title}>
        <h3 style={titleStyle}>{dialog.title}</h3>
        {dialog.method === 'select' && <SelectBody dialog={dialog} onRespond={onRespond} />}
        {dialog.method === 'confirm' && <ConfirmBody dialog={dialog} onRespond={onRespond} />}
        {dialog.method === 'input' && <InputBody dialog={dialog} onRespond={onRespond} cancel={cancel} />}
        {dialog.method === 'editor' && <EditorBody dialog={dialog} onRespond={onRespond} cancel={cancel} />}
      </div>
    </div>
  )
}

// ─── Select ──────────────────────────────────────────────────

type SelectDialog = Extract<PiUIDialog, { method: 'select' }>

function SelectBody({ dialog, onRespond }: { dialog: SelectDialog; onRespond: (r: PiUIResponse) => void }) {
  const optionStyle: CSSProperties = {
    width: '100%',
    textAlign: 'left',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text)',
    cursor: 'pointer',
    fontSize: 13,
    borderRadius: 4,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {dialog.options.map((opt) => (
        <button
          key={opt}
          style={optionStyle}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '0.7' }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '1' }}
          onClick={() => onRespond({ id: dialog.id, value: opt })}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

// ─── Confirm ─────────────────────────────────────────────────

type ConfirmDialog = Extract<PiUIDialog, { method: 'confirm' }>

function ConfirmBody({ dialog, onRespond }: { dialog: ConfirmDialog; onRespond: (r: PiUIResponse) => void }) {
  return (
    <>
      <p style={{ color: 'var(--color-text)', margin: '0 0 12px 0', fontSize: 13 }}>
        {dialog.message}
      </p>
      <div style={buttonRowStyle}>
        <button
          style={secondaryButtonStyle}
          onClick={() => onRespond({ id: dialog.id, confirmed: false })}
        >
          No
        </button>
        <button
          style={primaryButtonStyle}
          onClick={() => onRespond({ id: dialog.id, confirmed: true })}
        >
          Yes
        </button>
      </div>
    </>
  )
}

// ─── Input ───────────────────────────────────────────────────

type InputDialog = Extract<PiUIDialog, { method: 'input' }>

function InputBody({ dialog, onRespond, cancel }: { dialog: InputDialog; onRespond: (r: PiUIResponse) => void; cancel: () => void }) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    onRespond({ id: dialog.id, value })
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        style={inputStyle}
        placeholder={dialog.placeholder ?? ''}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
      />
      <div style={buttonRowStyle}>
        <button style={secondaryButtonStyle} onClick={cancel}>Cancel</button>
        <button style={primaryButtonStyle} onClick={submit}>Submit</button>
      </div>
    </>
  )
}

// ─── Editor ──────────────────────────────────────────────────

type EditorDialog = Extract<PiUIDialog, { method: 'editor' }>

function EditorBody({ dialog, onRespond, cancel }: { dialog: EditorDialog; onRespond: (r: PiUIResponse) => void; cancel: () => void }) {
  const [value, setValue] = useState(dialog.prefill ?? '')

  const submit = () => {
    onRespond({ id: dialog.id, value })
  }

  return (
    <>
      <textarea
        style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div style={buttonRowStyle}>
        <button style={secondaryButtonStyle} onClick={cancel}>Cancel</button>
        <button style={primaryButtonStyle} onClick={submit}>Submit</button>
      </div>
    </>
  )
}
