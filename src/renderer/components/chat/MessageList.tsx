import React, { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { MarkdownRenderer } from './MarkdownRenderer'
import { StreamingIndicator } from './StreamingIndicator'
import { useSettingsStore } from '../../stores/settingsStore'
import type { Message, StreamPart } from '../../../shared/types'
import type { TaskNotification } from '../../stores/chatStore'

function ContextClearedDivider({ clearedCount }: { clearedCount: number }) {
  return (
    <div className="flex items-center gap-3 my-4" style={{ color: 'var(--color-text-muted)' }}>
      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
      <span className="text-xs whitespace-nowrap">
        Context cleared{clearedCount > 0 ? ` — ${clearedCount} message${clearedCount !== 1 ? 's' : ''}` : ''}
      </span>
      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
    </div>
  )
}

function CompactSummaryBubble({ summary, clearedCount, isCompacting }: { summary: string; clearedCount: number; isCompacting: boolean }) {
  return (
    <div className="flex justify-center mb-4">
      <div
        className="rounded-lg px-4 py-3 text-xs max-w-[80%] compact:max-w-[95%]"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, var(--color-bg))',
          color: 'var(--color-text)',
          border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
        }}
      >
        <div className="font-medium mb-1.5" style={{ color: 'var(--color-accent)' }}>
          /compact{clearedCount > 0 ? ` — ${clearedCount} message${clearedCount !== 1 ? 's' : ''} compacted` : ''}
        </div>
        {isCompacting ? (
          <div className="animate-pulse" style={{ color: 'var(--color-text-muted)' }}>Compacting conversation...</div>
        ) : (
          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}><MarkdownRenderer content={summary} /></div>
        )}
      </div>
    </div>
  )
}

interface MessageListProps {
  messages: Message[]
  clearedAt?: string | null
  compactSummary?: string | null
  isCompacting?: boolean
  isStreaming: boolean
  streamParts: StreamPart[]
  streamingContent: string
  isLoading: boolean
  taskNotifications?: TaskNotification[]
  onEdit: (messageId: number, content: string) => void
  onRegenerate: () => void
  onFork: (messageId: number) => void
  onStopGeneration: () => void
}

export function MessageList({
  messages,
  clearedAt,
  compactSummary,
  isCompacting,
  isStreaming,
  streamParts,
  streamingContent,
  isLoading,
  taskNotifications,
  onEdit,
  onRegenerate,
  onFork,
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
        className="h-full overflow-y-auto overflow-x-hidden py-4 px-6 mobile:px-3"
      >
        <div className={chatLayout !== 'wide' ? 'max-w-3xl mx-auto' : undefined}>
          {messages.map((msg, idx) => {
            const showDivider = clearedAt
              && idx > 0
              && messages[idx - 1].created_at <= clearedAt
              && msg.created_at > clearedAt
            return (
              <React.Fragment key={msg.id}>
                {showDivider && (
                  compactSummary
                    ? <CompactSummaryBubble summary={compactSummary} clearedCount={idx} isCompacting={false} />
                    : <ContextClearedDivider clearedCount={idx} />
                )}
                <MessageBubble
                  message={msg}
                  isLast={idx === messages.length - 1}
                  onEdit={onEdit}
                  onRegenerate={onRegenerate}
                  onFork={onFork}
                />
              </React.Fragment>
            )
          })}
          {clearedAt && messages.length > 0 && messages[messages.length - 1].created_at <= clearedAt && (
            compactSummary || isCompacting
              ? <CompactSummaryBubble summary={compactSummary || ''} clearedCount={messages.length} isCompacting={!!isCompacting} />
              : <ContextClearedDivider clearedCount={messages.length} />
          )}

          {/* Background agent task notifications (arrive between turns) */}
          {taskNotifications && taskNotifications.length > 0 && !isStreaming && (
            <div className="mb-4">
              {taskNotifications.map((notif, idx) => {
                const isFailed = notif.taskStatus === 'failed'
                return (
                  <div
                    key={`tn_${idx}`}
                    className="flex justify-start mb-2"
                  >
                    <div
                      className="rounded-lg px-4 py-3 max-w-[80%] mobile:max-w-[95%] text-sm border"
                      style={{
                        backgroundColor: isFailed
                          ? 'color-mix(in srgb, var(--color-error, #ef4444) 10%, transparent)'
                          : 'color-mix(in srgb, var(--color-success, #22c55e) 10%, transparent)',
                        borderColor: isFailed
                          ? 'color-mix(in srgb, var(--color-error, #ef4444) 30%, transparent)'
                          : 'color-mix(in srgb, var(--color-success, #22c55e) 30%, transparent)',
                        color: 'var(--color-text)',
                      }}
                    >
                      <div className="text-xs font-medium mb-1" style={{ color: isFailed ? 'var(--color-error, #ef4444)' : 'var(--color-success, #22c55e)' }}>
                        Agent {notif.taskStatus || 'completed'}
                      </div>
                      <div>{notif.summary}</div>
                    </div>
                  </div>
                )
              })}
            </div>
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
          className="absolute bottom-4 right-6 rounded-full flex items-center justify-center shadow-lg transition-opacity hover:opacity-90 bg-primary text-contrast w-8 h-8 mobile:w-11 mobile:h-11"
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  )
}
