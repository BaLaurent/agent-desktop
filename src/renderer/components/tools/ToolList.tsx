import { useEffect } from 'react'
import { useToolsStore } from '../../stores/toolsStore'
import type { AllowedTool } from '../../../shared/types'

export function ToolList() {
  const { tools, isLoading, allEnabled, loadTools, toggleTool, enableAll, disableAll } =
    useToolsStore()

  useEffect(() => {
    loadTools()
  }, [loadTools])

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Header actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={enableAll}
          disabled={allEnabled}
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          Enable All
        </button>
        <button
          onClick={disableAll}
          disabled={tools.every((t) => !t.enabled)}
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--color-surface)] text-[var(--color-text)] hover:opacity-80 transition-opacity disabled:opacity-40"
        >
          Disable All
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="text-sm py-4 text-center text-[var(--color-text-muted)]">Loading...</div>
      )}

      {/* Tool rows */}
      {!isLoading && tools.length > 0 && (
        <div className="flex flex-col gap-1">
          {tools.map((tool) => (
            <ToolRow key={tool.name} tool={tool} onToggle={toggleTool} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolRow({
  tool,
  onToggle,
}: {
  tool: AllowedTool
  onToggle: (name: string) => Promise<void>
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--color-surface)]">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--color-text)] truncate">{tool.name}</div>
        <div className="text-xs text-[var(--color-text-muted)] truncate">{tool.description}</div>
      </div>

      <button
        onClick={() => onToggle(tool.name)}
        className="flex-shrink-0 w-9 h-5 rounded-full relative transition-colors"
        style={{
          backgroundColor: tool.enabled ? 'var(--color-success)' : 'var(--color-text-muted)',
          opacity: tool.enabled ? 1 : 0.4,
        }}
        title={tool.enabled ? 'Disable' : 'Enable'}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
          style={{ left: tool.enabled ? '18px' : '2px' }}
        />
      </button>
    </div>
  )
}
