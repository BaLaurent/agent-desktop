import { useState } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'

export interface ThinkingBlockProps {
  content: string
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const trimmed = content.trim()
  if (!trimmed) return null

  return (
    <div
      className="mb-2 rounded border text-xs"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-text-muted) 8%, transparent)',
        borderColor: 'color-mix(in srgb, var(--color-text-muted) 25%, transparent)',
        color: 'var(--color-text-muted)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 w-full px-2 py-1 text-left font-medium select-none"
        style={{ color: 'var(--color-text-muted)' }}
        aria-expanded={expanded}
      >
        <span style={{ display: 'inline-block', width: '0.7em' }}>{expanded ? '▼' : '▶'}</span>
        <span>Reasoning</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 italic" style={{ borderTop: '1px solid color-mix(in srgb, var(--color-text-muted) 20%, transparent)' }}>
          <MarkdownRenderer content={trimmed} />
        </div>
      )}
    </div>
  )
}
