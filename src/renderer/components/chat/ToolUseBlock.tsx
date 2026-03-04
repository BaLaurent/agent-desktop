import { useState } from 'react'
import { CodeBlock } from './CodeBlock'
import type { StreamPart } from '../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

/** Truncate a file path to the last N directory segments + filename */
function truncatePath(filePath: string, segments = 3): string {
  const parts = filePath.split('/')
  if (parts.length <= segments + 1) return filePath
  return parts.slice(-(segments + 1)).join('/')
}

/** Extract contextual info to display next to the tool name */
function getToolContext(tool: ToolPart): string | null {
  if (!tool.input) return null
  switch (tool.name) {
    case 'Bash':
      return (tool.input.description as string) || null
    case 'Read':
    case 'Edit':
      return tool.input.file_path ? truncatePath(tool.input.file_path as string) : null
    default:
      return null
  }
}

interface ToolUseBlockProps {
  tool: ToolPart
}

export function ToolUseBlock({ tool }: ToolUseBlockProps) {
  const isRunning = tool.status === 'running'
  const hasInput = tool.input && Object.keys(tool.input).length > 0
  const hasOutput = !isRunning && !!tool.output
  const context = getToolContext(tool)

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
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: 'var(--color-tool)' }} className="font-semibold shrink-0">
            {isRunning ? '\u2699\uFE0F' : '\u2705'} {tool.name}
          </span>
          {context && (
            <span
              className="truncate min-w-0"
              style={{ color: 'var(--color-text-muted)' }}
              title={context}
            >
              · {context}
            </span>
          )}
          {isRunning && (
            <span
              className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin shrink-0"
              style={{ borderColor: 'var(--color-tool)', borderTopColor: 'transparent' }}
            />
          )}
        </div>
        {tool.summary && !context && (
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
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: 'var(--color-tool)' }} className="font-semibold shrink-0">
            {isRunning ? '\u2699\uFE0F' : '\u2705'} {tool.name}
          </span>
          {context && (
            <span
              className="truncate min-w-0"
              style={{ color: 'var(--color-text-muted)' }}
              title={context}
            >
              · {context}
            </span>
          )}
          {isRunning && (
            <span
              className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin shrink-0"
              style={{ borderColor: 'var(--color-tool)', borderTopColor: 'transparent' }}
            />
          )}
          <div className="flex gap-1 ml-auto shrink-0">
            {hasInput && (
              <button
                onClick={() => setShowInput((s) => !s)}
                className="rounded transition-opacity hover:opacity-80 px-1.5 py-0.5 text-[10px] mobile:px-3 mobile:py-2 mobile:text-xs"
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
                className="rounded transition-opacity hover:opacity-80 px-1.5 py-0.5 text-[10px] mobile:px-3 mobile:py-2 mobile:text-xs"
                style={{ color: 'var(--color-tool)' }}
                aria-expanded={showOutput}
                aria-label="Toggle tool output"
              >
                {showOutput ? '\u25BC' : '\u25B6'} Output
              </button>
            )}
          </div>
        </div>
        {tool.summary && !showOutput && !context && (
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
