import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolUseBlock } from './ToolUseBlock'
import { TaskGroupBlock } from './TaskGroupBlock'
import { ToolApprovalBlock } from './ToolApprovalBlock'
import { AskUserBlock } from './AskUserBlock'
import { McpStatusBlock } from './McpStatusBlock'
import { groupStreamParts } from '../../utils/groupStreamParts'
import { useAgentDisplayName } from '../../hooks/useAgentDisplayName'
import type { StreamPart } from '../../../shared/types'

interface StreamingIndicatorProps {
  streamParts: StreamPart[]
  onStop: () => void
}

export function StreamingIndicator({ streamParts, onStop }: StreamingIndicatorProps) {
  const hasContent = streamParts.length > 0
  const agentName = useAgentDisplayName()

  return (
    <div className="flex justify-start mb-4">
      <div
        className="rounded-lg rounded-bl-sm px-4 py-3 max-w-[80%] mobile:max-w-[95%]"
        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
        role="status"
        aria-live="polite"
        aria-label={`${agentName} is responding`}
      >
        {/* Role label */}
        <div className="text-xs font-medium mb-1" style={{ color: 'var(--color-accent)' }}>
          {agentName}
        </div>

        {/* Stream parts or typing indicator */}
        {hasContent ? (
          <div className="text-sm">
            {groupStreamParts(streamParts).map((grouped, idx) => {
              if (grouped.kind === 'task_group') {
                return <TaskGroupBlock key={`tg_${idx}`} tasks={grouped.tasks} />
              }
              const part = grouped.part
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
              if (part.type === 'retry') {
                return (
                  <div
                    key={`retry_${idx}`}
                    className="my-2 rounded px-3 py-2 text-xs border"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--color-warning, #f59e0b) 30%, transparent)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <span className="font-medium" style={{ color: 'var(--color-warning, #f59e0b)' }}>
                      {part.message}
                    </span>
                  </div>
                )
              }
              if (part.type === 'system_message') {
                return (
                  <div
                    key={`sys_${idx}`}
                    className="my-2 rounded px-3 py-2 text-xs border"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {part.hookEvent && (
                      <span className="font-medium mr-1" style={{ color: 'var(--color-accent)' }}>
                        {part.hookEvent}
                      </span>
                    )}
                    <MarkdownRenderer content={part.content} />
                  </div>
                )
              }
              if (part.type === 'task_notification') {
                const isFailed = part.taskStatus === 'failed'
                return (
                  <div
                    key={`task_${idx}`}
                    className="my-2 rounded px-3 py-2 text-xs border"
                    style={{
                      backgroundColor: isFailed
                        ? 'color-mix(in srgb, var(--color-error, #ef4444) 10%, transparent)'
                        : 'color-mix(in srgb, var(--color-success, #22c55e) 10%, transparent)',
                      borderColor: isFailed
                        ? 'color-mix(in srgb, var(--color-error, #ef4444) 30%, transparent)'
                        : 'color-mix(in srgb, var(--color-success, #22c55e) 30%, transparent)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <span className="font-medium mr-1" style={{ color: isFailed ? 'var(--color-error, #ef4444)' : 'var(--color-success, #22c55e)' }}>
                      Agent {part.taskStatus || 'completed'}
                    </span>
                    {part.summary}
                  </div>
                )
              }
              return <ToolUseBlock key={part.id || `tool_${idx}`} tool={part} />
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            <span>{agentName} is typing</span>
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
          className="mt-2 rounded font-medium transition-colors hover:opacity-90 bg-error text-contrast px-3 py-1 text-xs mobile:px-4 mobile:py-3 mobile:text-sm"
          aria-label="Stop generating response"
        >
          Stop generating
        </button>
      </div>
    </div>
  )
}
