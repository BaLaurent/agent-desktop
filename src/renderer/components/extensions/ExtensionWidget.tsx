import type { CSSProperties } from 'react'
import type { PiUIWidget } from '../../../shared/piUITypes'

interface ExtensionWidgetProps {
  widget: PiUIWidget
}

const containerStyle: CSSProperties = {
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  borderLeft: '4px solid var(--color-primary)',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 12,
  fontFamily: 'monospace',
}

export function ExtensionWidget({ widget }: ExtensionWidgetProps) {
  return (
    <div style={containerStyle} data-testid={`extension-widget-${widget.key}`}>
      {widget.content.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}
