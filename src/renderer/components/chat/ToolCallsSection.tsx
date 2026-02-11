import { useState } from 'react'
import { ToolUseBlock } from './ToolUseBlock'
import type { ToolCall, StreamPart, AskUserQuestion } from '../../../shared/types'

interface ToolCallsSectionProps {
  toolCallsJson: string
}

function parseToolCalls(json: string): ToolCall[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Fallback renderer for AskUserQuestion that somehow ended up persisted as a ToolCall
function AskUserFallback({ tc }: { tc: ToolCall }) {
  let questions: AskUserQuestion[] = []
  let answers: Record<string, string> = {}
  try { questions = (JSON.parse(tc.input) as { questions?: AskUserQuestion[] }).questions ?? [] } catch { /* ignore */ }
  try { answers = (JSON.parse(tc.output) as { answers?: Record<string, string> }).answers ?? {} } catch { /* ignore */ }

  return (
    <div
      className="rounded-md p-3 text-xs mb-1"
      style={{
        borderLeft: '3px solid var(--color-primary)',
        backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, transparent)',
      }}
    >
      <div className="font-semibold mb-2" style={{ color: 'var(--color-primary)' }}>
        Agent asked a question
      </div>
      {questions.map((q, i) => (
        <div key={i} className="mb-2">
          <div className="font-medium text-body">{q.question}</div>
          {answers[String(i)] && (
            <div className="mt-1 text-muted italic">Answer: {answers[String(i)]}</div>
          )}
        </div>
      ))}
    </div>
  )
}

function toolCallToStreamPart(tc: ToolCall): Extract<StreamPart, { type: 'tool' }> {
  let input: Record<string, unknown> | undefined
  if (tc.input && tc.input !== '{}') {
    try { input = JSON.parse(tc.input) as Record<string, unknown> } catch { /* ignore */ }
  }
  return {
    type: 'tool',
    name: tc.name,
    id: tc.id,
    status: tc.status === 'error' ? 'done' : tc.status,
    output: tc.output || undefined,
    input,
  }
}

export function ToolCallsSection({ toolCallsJson }: ToolCallsSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const toolCalls = parseToolCalls(toolCallsJson)

  if (toolCalls.length === 0) return null

  // Separate AskUserQuestion calls (rendered inline) from regular tools
  const askUserCalls = toolCalls.filter((tc) => tc.name === 'AskUserQuestion')
  const regularCalls = toolCalls.filter((tc) => tc.name !== 'AskUserQuestion')

  return (
    <>
      {askUserCalls.map((tc) => (
        <AskUserFallback key={tc.id} tc={tc} />
      ))}

      {regularCalls.length > 0 && (
        <div
          className="mt-2 rounded-md overflow-hidden text-xs"
          style={{
            borderLeft: '3px solid var(--color-tool)',
            backgroundColor: 'color-mix(in srgb, var(--color-tool) 5%, transparent)',
          }}
        >
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full px-3 py-2 flex items-center gap-2 hover:opacity-80 transition-opacity text-left"
            style={{ color: 'var(--color-tool)' }}
            aria-expanded={expanded}
            aria-label={`${regularCalls.length} tools used, click to ${expanded ? 'collapse' : 'expand'}`}
          >
            <span className="font-semibold">
              {expanded ? '\u25BC' : '\u25B6'} {regularCalls.length} tool{regularCalls.length !== 1 ? 's' : ''} used
            </span>
          </button>

          {expanded && (
            <div className="px-2 pb-2">
              {regularCalls.map((tc) => (
                <ToolUseBlock key={tc.id} tool={toolCallToStreamPart(tc)} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
