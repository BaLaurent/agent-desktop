import { diffChars } from 'diff'

interface DiffViewProps {
  oldStr: string
  newStr: string
}

function renderDiffSpans(
  changes: ReturnType<typeof diffChars>,
  side: 'left' | 'right',
): React.ReactNode[] {
  return changes
    .filter((c) => (side === 'left' ? !c.added : !c.removed))
    .map((c, i) => {
      const className = c.removed
        ? 'diff-removed'
        : c.added
          ? 'diff-added'
          : ''
      return (
        <span key={i} className={className || undefined}>
          {c.value}
        </span>
      )
    })
}

export function DiffView({ oldStr, newStr }: DiffViewProps) {
  const changes = diffChars(oldStr, newStr)

  const leftSpans = renderDiffSpans(changes, 'left')
  const rightSpans = renderDiffSpans(changes, 'right')

  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  return (
    <div className="flex gap-0 rounded overflow-hidden border border-deep text-xs font-mono">
      {/* Left: Before */}
      <div className="flex-1 min-w-0 overflow-hidden" style={{
        backgroundColor: 'color-mix(in srgb, var(--color-error) 6%, transparent)',
      }}>
        <div
          className="px-2 py-1 text-[10px] font-semibold border-b border-deep"
          style={{ color: 'var(--color-error)' }}
        >
          Before ({oldLines.length} {oldLines.length === 1 ? 'line' : 'lines'})
        </div>
        <pre
          data-testid="diff-left"
          className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 m-0 min-w-0"
        >
          {leftSpans}
        </pre>
      </div>

      {/* Divider */}
      <div className="w-px shrink-0" style={{ backgroundColor: 'var(--color-deep)' }} />

      {/* Right: After */}
      <div className="flex-1 min-w-0 overflow-hidden" style={{
        backgroundColor: 'color-mix(in srgb, var(--color-success) 6%, transparent)',
      }}>
        <div
          className="px-2 py-1 text-[10px] font-semibold border-b border-deep"
          style={{ color: 'var(--color-success)' }}
        >
          After ({newLines.length} {newLines.length === 1 ? 'line' : 'lines'})
        </div>
        <pre
          data-testid="diff-right"
          className="text-xs font-mono whitespace-pre-wrap overflow-x-auto p-2 m-0 min-w-0"
        >
          {rightSpans}
        </pre>
      </div>
    </div>
  )
}
