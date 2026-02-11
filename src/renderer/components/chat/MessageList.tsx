import { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { StreamingIndicator } from './StreamingIndicator'
import { useSettingsStore } from '../../stores/settingsStore'
import type { Message, StreamPart } from '../../../shared/types'

interface MessageListProps {
  messages: Message[]
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
          {messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={idx === messages.length - 1}
              onEdit={onEdit}
              onRegenerate={onRegenerate}
            />
          ))}

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
