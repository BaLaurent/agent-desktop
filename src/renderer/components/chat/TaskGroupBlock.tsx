import { useState } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { StreamPart } from '../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

interface TaskGroupBlockProps {
  tasks: ToolPart[]
}

function TaskItemBlock({ task }: { task: ToolPart }) {
  const isRunning = task.status === 'running'
  const hasOutput = !isRunning && !!task.output
  const [showOutput, setShowOutput] = useState(true)

  const description = (task.input?.description as string) || ''

  return (
    <div
      className="my-1 rounded-md text-xs font-mono overflow-hidden"
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
            {isRunning ? '\u2699\uFE0F' : '\u2705'} {task.name}
          </span>
          {description && (
            <span
              className="truncate font-normal"
              style={{ color: 'var(--color-text-muted)' }}
              title={description}
            >
              {description}
            </span>
          )}
          {isRunning && (
            <span
              className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin ml-auto flex-shrink-0"
              style={{ borderColor: 'var(--color-tool)', borderTopColor: 'transparent' }}
            />
          )}
          {hasOutput && (
            <button
              onClick={() => setShowOutput((s) => !s)}
              className="ml-auto flex-shrink-0 rounded transition-opacity hover:opacity-80 px-1.5 py-0.5 text-[10px] mobile:px-3 mobile:py-2 mobile:text-xs"
              style={{ color: 'var(--color-tool)' }}
              aria-expanded={showOutput}
              aria-label="Toggle agent response"
            >
              {showOutput ? '\u25BC' : '\u25B6'} Response
            </button>
          )}
        </div>
        {task.summary && !showOutput && (
          <div
            className="mt-1 truncate"
            style={{ color: 'var(--color-text-muted)' }}
            title={task.summary}
          >
            {task.summary}
          </div>
        )}
      </div>

      {/* Agent response as markdown */}
      {showOutput && hasOutput && (
        <div className="px-3 pb-2 font-sans" style={{ color: 'var(--color-text)' }}>
          <MarkdownRenderer content={task.output!} />
        </div>
      )}
    </div>
  )
}

export function TaskGroupBlock({ tasks }: TaskGroupBlockProps) {
  const [expanded, setExpanded] = useState(true)
  const anyRunning = tasks.some((t) => t.status === 'running')

  // Force expanded while any task is running
  const isExpanded = anyRunning || expanded

  return (
    <div
      className="my-2 rounded-md text-xs overflow-hidden"
      style={{
        borderLeft: '3px solid var(--color-accent)',
        backgroundColor: 'color-mix(in srgb, var(--color-accent) 5%, transparent)',
        ...(anyRunning ? { animation: 'tool-pulse 1.5s ease-in-out infinite' } : {}),
      }}
    >
      {/* Header */}
      <button
        onClick={() => { if (!anyRunning) setExpanded((e) => !e) }}
        className="w-full px-3 py-2 flex items-center gap-2 hover:opacity-80 transition-opacity text-left"
        style={{
          color: 'var(--color-accent)',
          ...(anyRunning ? { cursor: 'default' } : {}),
        }}
        aria-expanded={isExpanded}
        aria-label={`${tasks.length} sub-agents, click to ${isExpanded ? 'collapse' : 'expand'}`}
      >
        <span className="font-semibold">
          {isExpanded ? '\u25BC' : '\u25B6'} {'\u26A1'} {tasks.length} sub-agent{tasks.length !== 1 ? 's' : ''}
        </span>
        {anyRunning ? (
          <span
            className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
          />
        ) : (
          <span style={{ color: 'var(--color-accent)' }}>{'\u2713'}</span>
        )}
      </button>

      {/* Body */}
      {isExpanded && (
        <div className="pl-3 pb-2">
          {tasks.map((task) => (
            <TaskItemBlock key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  )
}
