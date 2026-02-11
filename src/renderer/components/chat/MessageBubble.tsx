import { useState, useCallback } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCallsSection } from './ToolCallsSection'
import type { Message } from '../../../shared/types'

interface MessageBubbleProps {
  message: Message
  isLast: boolean
  onEdit?: (messageId: number, content: string) => void
  onRegenerate?: () => void
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffSec = Math.floor((now - then) / 1000)

  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

export function MessageBubble({ message, isLast, onEdit, onRegenerate }: MessageBubbleProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [showActions, setShowActions] = useState(false)

  const isUser = message.role === 'user'

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message.content)
  }, [message.content])

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content)
    setIsEditing(true)
  }, [message.content])

  const handleSaveEdit = useCallback(() => {
    if (editContent.trim() && onEdit) {
      onEdit(message.id, editContent.trim())
    }
    setIsEditing(false)
  }, [editContent, message.id, onEdit])

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditContent(message.content)
  }, [message.content])

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 group`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 relative ${
          isUser ? 'rounded-br-sm' : 'rounded-bl-sm'
        }`}
        style={{
          backgroundColor: isUser ? 'var(--color-deep)' : 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
      >
        {/* Role label */}
        <div
          className="text-xs font-medium mb-1"
          style={{ color: isUser ? 'var(--color-primary)' : 'var(--color-accent)' }}
        >
          {isUser ? 'You' : 'Claude'}
        </div>

        {/* Content */}
        {isEditing ? (
          <div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full rounded p-2 text-sm resize-none"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-text-muted)',
              }}
              rows={4}
              autoFocus
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1 rounded text-xs font-medium bg-primary text-contrast"
              >
                Save & Send
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1 rounded text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm">
            {isUser ? (
              <MarkdownRenderer content={message.content} />
            ) : (
              <>
                <MarkdownRenderer content={message.content} />
                {message.tool_calls && (
                  <ToolCallsSection toolCallsJson={message.tool_calls} />
                )}
              </>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div
          className="text-[10px] mt-2 select-none"
          style={{ color: 'var(--color-text-muted)' }}
          title={new Date(message.created_at).toLocaleString()}
        >
          {formatRelativeTime(message.created_at)}
        </div>

        {/* Hover actions */}
        {showActions && !isEditing && (
          <div
            className="absolute -top-3 right-2 flex gap-1 rounded px-1 py-0.5 shadow-md"
            style={{ backgroundColor: 'var(--color-deep)' }}
          >
            <button
              onClick={handleCopy}
              className="px-2 py-0.5 rounded text-[10px] hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-text-muted)' }}
              title="Copy"
            >
              Copy
            </button>
            {isUser && onEdit && (
              <button
                onClick={handleStartEdit}
                className="px-2 py-0.5 rounded text-[10px] hover:opacity-80 transition-opacity"
                style={{ color: 'var(--color-text-muted)' }}
                title="Edit"
              >
                Edit
              </button>
            )}
            {!isUser && isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="px-2 py-0.5 rounded text-[10px] hover:opacity-80 transition-opacity"
                style={{ color: 'var(--color-text-muted)' }}
                title="Regenerate"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
