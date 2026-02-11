import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolUseBlock } from './ToolUseBlock'
import { ToolApprovalBlock } from './ToolApprovalBlock'
import { AskUserBlock } from './AskUserBlock'
import { McpStatusBlock } from './McpStatusBlock'
import type { StreamPart } from '../../../shared/types'

interface StreamingIndicatorProps {
  streamParts: StreamPart[]
  onStop: () => void
}

export function StreamingIndicator({ streamParts, onStop }: StreamingIndicatorProps) {
  const hasContent = streamParts.length > 0

  return (
    <div className="flex justify-start mb-4">
      <div
        className="max-w-[80%] rounded-lg rounded-bl-sm px-4 py-3"
        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
        role="status"
        aria-live="polite"
        aria-label="Claude is responding"
      >
        {/* Role label */}
        <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-accent)' }}>
          Claude
        </div>

        {/* Stream parts or typing indicator */}
        {hasContent ? (
          <div className="text-sm">
            {streamParts.map((part, idx) => {
              if (part.type === 'text') {
                return <MarkdownRenderer key={`text_${idx}`} content={part.content} />
              }
              if (part.type === 'tool_approval') {
                return <ToolApprovalBlock key={part.requestId} approval={part} />
              }
              if (part.type === 'ask_user') {
                return <AskUserBlock key={part.requestId} askUser={part} />
              }
              if (part.type === 'mcp_status') {
                return <McpStatusBlock key={`mcp_${idx}`} servers={part.servers} />
              }
              return <ToolUseBlock key={part.id || `tool_${idx}`} tool={part} />
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            <span>Claude is typing</span>
            <span className="inline-flex gap-0.5">
              <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
            </span>
          </div>
        )}

        {/* Stop button */}
        <button
          onClick={onStop}
          className="mt-2 px-3 py-1 rounded text-xs font-medium transition-colors hover:opacity-90 bg-error text-contrast"
          aria-label="Stop generating response"
        >
          Stop generating
        </button>
      </div>
    </div>
  )
}
