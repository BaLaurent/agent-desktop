import React, { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { StreamingIndicator } from './StreamingIndicator'
import { useSettingsStore } from '../../stores/settingsStore'
import type { Message, StreamPart } from '../../../shared/types'

function ContextClearedDivider() {
  return (
    <div className="flex items-center gap-3 my-4" style={{ color: 'var(--color-text-muted)' }}>
      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
      <span className="text-xs whitespace-nowrap">Context cleared</span>
      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
    </div>
  )
}

interface MessageListProps {
  messages: Message[]
  clearedAt?: string | null
  isStreaming: boolean
  streamParts: StreamPart[]
  streamingContent: string
  isLoading: boolean
  onEdit: (messageId: number, content: string) => void
  onRegenerate: () => void
  onStopGeneration: () => void
}

export function MessageList({
  messages,
  clearedAt,
  isStreaming,
  streamParts,
  streamingContent,
  isLoading,
  onEdit,
  onRegenerate,
  onStopGeneration,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const isNearBottom = useRef(true)
  const autoScroll = useSettingsStore((s) => s.settings.autoScroll ?? 'true')
  const chatLayout = useSettingsStore((s) => s.settings.chatLayout ?? 'tight')

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isNearBottom.current = distFromBottom < 100
    setShowScrollBtn(distFromBottom > 200)
  }, [])

  // Auto-scroll on new messages or streaming content
  useEffect(() => {
    if (autoScroll !== 'false' && isNearBottom.current) {
      scrollToBottom()
    }
  }, [messages, streamingContent, streamParts, scrollToBottom, autoScroll])

  if (isLoading && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className={`space-y-3 w-full px-6 ${chatLayout !== 'wide' ? 'max-w-2xl' : ''}`}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-lg h-16 animate-pulse"
              style={{ backgroundColor: 'var(--color-surface)' }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-6 py-4"
      >
        <div className={chatLayout !== 'wide' ? 'max-w-3xl mx-auto' : undefined}>
          {messages.map((msg, idx) => {
            const showDivider = clearedAt
              && idx > 0
              && messages[idx - 1].created_at <= clearedAt
              && msg.created_at > clearedAt
            return (
              <React.Fragment key={msg.id}>
                {showDivider && <ContextClearedDivider />}
                <MessageBubble
                  message={msg}
                  isLast={idx === messages.length - 1}
                  onEdit={onEdit}
                  onRegenerate={onRegenerate}
                />
              </React.Fragment>
            )
          })}
          {clearedAt && messages.length > 0 && messages[messages.length - 1].created_at <= clearedAt && (
            <ContextClearedDivider />
          )}

          {isStreaming && (
            <StreamingIndicator
              streamParts={streamParts}
              onStop={onStopGeneration}
            />
          )}
        </div>
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-6 w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-opacity hover:opacity-90 bg-primary text-contrast"
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  )
}
