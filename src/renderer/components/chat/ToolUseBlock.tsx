import { useState } from 'react'
import { CodeBlock } from './CodeBlock'
import type { StreamPart } from '../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

interface ToolUseBlockProps {
  tool: ToolPart
}

export function ToolUseBlock({ tool }: ToolUseBlockProps) {
  const isRunning = tool.status === 'running'
  const hasInput = tool.input && Object.keys(tool.input).length > 0
  const hasOutput = !isRunning && !!tool.output

  const [showInput, setShowInput] = useState(false)
  const [showOutput, setShowOutput] = useState(false)

  // If no input/output, render compact view
  if (!hasInput && !hasOutput) {
    return (
      <div
        className="my-2 rounded-md px-3 py-2 text-xs font-mono"
        style={{
          borderLeft: '3px solid var(--color-tool)',
          backgroundColor: 'color-mix(in srgb, var(--color-tool) 8%, transparent)',
          ...(isRunning ? { animation: 'tool-pulse 1.5s ease-in-out infinite' } : {}),
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--color-tool)' }} className="font-semibold">
            {isRunning ? '\u2699\uFE0F' : '\u2705'} {tool.name}
          </span>
          {isRunning && (
            <span
              className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--color-tool)', borderTopColor: 'transparent' }}
            />
          )}
        </div>
        {tool.summary && (
          <div
            className="mt-1 text-xs truncate"
            style={{ color: 'var(--color-text-muted)' }}
            title={tool.summary}
          >
            {tool.summary}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="my-2 rounded-md text-xs font-mono overflow-hidden"
      style={{
        borderLeft: '3px solid var(--color-tool)',
        backgroundColor: 'color-mix(in srgb, var(--color-tool) 8%, transparent)',
        ...(isRunning ? { animation: 'tool-pulse 1.5s ease-in-out infinite' } : {}),
      }}
    >
      {/* Header */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--color-tool)' }} className="font-semibold">
            {isRunning ? '\u2699\uFE0F' : '\u2705'} {tool.name}
          </span>
          {isRunning && (
            <span
              className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--color-tool)', borderTopColor: 'transparent' }}
            />
          )}
          <div className="flex gap-1 ml-auto">
            {hasInput && (
              <button
                onClick={() => setShowInput((s) => !s)}
                className="px-1.5 py-0.5 rounded text-[10px] transition-opacity hover:opacity-80"
                style={{ color: 'var(--color-tool)' }}
                aria-expanded={showInput}
                aria-label="Toggle tool input"
              >
                {showInput ? '\u25BC' : '\u25B6'} Input
              </button>
            )}
            {hasOutput && (
              <button
                onClick={() => setShowOutput((s) => !s)}
                className="px-1.5 py-0.5 rounded text-[10px] transition-opacity hover:opacity-80"
                style={{ color: 'var(--color-tool)' }}
                aria-expanded={showOutput}
                aria-label="Toggle tool output"
              >
                {showOutput ? '\u25BC' : '\u25B6'} Output
              </button>
            )}
          </div>
        </div>
        {tool.summary && !showOutput && (
          <div
            className="mt-1 text-xs truncate"
            style={{ color: 'var(--color-text-muted)' }}
            title={tool.summary}
          >
            {tool.summary}
          </div>
        )}
      </div>

      {/* Collapsible Input */}
      {showInput && hasInput && (
        <div className="px-3 pb-2">
          <CodeBlock language="json" defaultCollapsed={false}>
            {JSON.stringify(tool.input, null, 2)}
          </CodeBlock>
        </div>
      )}

      {/* Collapsible Output */}
      {showOutput && hasOutput && (
        <div className="px-3 pb-2">
          <CodeBlock language="text" defaultCollapsed={false}>
            {tool.output!}
          </CodeBlock>
        </div>
      )}
    </div>
  )
}
