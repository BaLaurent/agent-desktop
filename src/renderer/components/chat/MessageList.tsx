import React, { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { MarkdownRenderer } from './MarkdownRenderer'
import { StreamingIndicator } from './StreamingIndicator'
import { PlanApprovalBlock } from './PlanApprovalBlock'
import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import type { Message, StreamPart } from '../../../shared/types'
import type { TaskNotification, ContextDisplay } from '../../stores/chatStore'

/** Format a token count as compact k-units: 1234 -> "1.2k", 128000 -> "128k" */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`
}

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

function ContextInfoBubble({ display, onDismiss }: { display: ContextDisplay; onDismiss: () => void }) {
  const { breakdown, piStats } = display
  const { total, window: ctxWindow, autocompactBuffer, free, percentUsed, categories, preFirstTurn } = breakdown
  const freePct = ctxWindow > 0 ? Math.max(0, 100 - percentUsed) : 0
  return (
    <div className="flex justify-center mb-4">
      <div
        className="rounded-lg px-4 py-3 text-xs max-w-[80%] compact:max-w-[95%] relative"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, var(--color-bg))',
          color: 'var(--color-text)',
          border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
          minWidth: 360,
        }}
      >
        <button
          onClick={onDismiss}
          className="absolute top-1 right-2 text-xs opacity-60 hover:opacity-100"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Dismiss"
          title="Fermer"
        >×</button>
        <div className="font-medium mb-2" style={{ color: 'var(--color-accent)' }}>
          /context
        </div>
        <div className="text-sm mb-2">
          <span style={{ color: 'var(--color-text)' }}>{formatTokens(total)}</span>
          {' / '}
          <span>{formatTokens(ctxWindow)}</span>
          {' tokens'}
          <span style={{ color: 'var(--color-text-muted)' }}>{' — '}{percentUsed}%</span>
        </div>
        {piStats && (
          <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
            <span style={{ color: 'var(--color-text)' }}>${piStats.cost.toFixed(4)}</span>
            {' session cost'}
            <span>{' — '}{piStats.totalMessages} msgs, {piStats.toolCalls} tool calls</span>
          </div>
        )}
        {!preFirstTurn && (
          <div className="flex flex-col gap-0.5 mb-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <div className="uppercase tracking-wide text-[0.6rem] opacity-70 mb-0.5">Estimated usage by category</div>
            {categories.map((cat, i) => {
              const catPct = ctxWindow > 0 && cat.tokens != null && !cat.informational ? ((cat.tokens / ctxWindow) * 100) : null
              const isInfo = !!cat.informational
              return (
                <div key={i} className="flex justify-between gap-3" style={isInfo ? { opacity: 0.6, fontStyle: 'italic' } : undefined}>
                  <span className="flex items-center gap-1">
                    <span style={{ color: isInfo ? 'var(--color-text-muted)' : 'var(--color-accent)' }}>{isInfo ? '◦' : '▪'}</span>
                    <span style={{ color: 'var(--color-text)' }}>{cat.label}</span>
                    {cat.hint && <span className="text-[0.6rem] opacity-60">({cat.hint})</span>}
                  </span>
                  <span className="font-mono tabular-nums whitespace-nowrap">
                    {cat.tokens == null ? '—' : formatTokens(cat.tokens)}
                    {catPct != null && <span className="opacity-70 ml-1">({catPct.toFixed(1)}%)</span>}
                  </span>
                </div>
              )
            })}
            <div className="flex justify-between gap-3 mt-0.5">
              <span className="flex items-center gap-1">
                <span className="opacity-60">□</span>
                <span>Free space</span>
              </span>
              <span className="font-mono tabular-nums whitespace-nowrap">
                {formatTokens(free)} <span className="opacity-70">({freePct}%)</span>
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="flex items-center gap-1">
                <span className="opacity-60">⊠</span>
                <span>Autocompact buffer</span>
              </span>
              <span className="font-mono tabular-nums whitespace-nowrap">
                {formatTokens(autocompactBuffer)}
              </span>
            </div>
          </div>
        )}
        {preFirstTurn && (
          <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
            En attente du premier tour — la ventilation par catégorie apparaîtra après la première réponse.
          </div>
        )}
        {breakdown.tip && (
          <div
            className="text-[11px] mt-2 px-2 py-1.5 rounded border-l-2"
            style={{
              color: 'var(--color-text)',
              backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
              borderLeftColor: 'var(--color-accent)',
            }}
          >
            <span className="font-medium mr-1" style={{ color: 'var(--color-accent)' }}>💡 Astuce</span>
            {breakdown.tip}
          </div>
        )}
        <div className="text-[10px] opacity-60 mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
          Estimation locale (gpt-tokenizer, ±10%)
        </div>
      </div>
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
  contextDisplay?: ContextDisplay | null
  onDismissContextInfo?: () => void
  effectiveTtsResponseMode?: string
  effectiveAgentName?: string
  effectiveSdkBackend?: string
  conversationId?: number | null
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
  contextDisplay,
  onDismissContextInfo,
  effectiveTtsResponseMode,
  effectiveAgentName,
  effectiveSdkBackend,
  conversationId,
  onEdit,
  onRegenerate,
  onFork,
  onStopGeneration,
}: MessageListProps) {
  const pendingPlanApproval = useChatStore(
    (s) => (conversationId != null ? s.pendingPlanApprovals[conversationId] : undefined),
  )
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
                  effectiveTtsResponseMode={effectiveTtsResponseMode}
                  effectiveAgentName={effectiveAgentName}
                  effectiveSdkBackend={effectiveSdkBackend}
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

          {contextDisplay && (
            <ContextInfoBubble display={contextDisplay} onDismiss={onDismissContextInfo ?? (() => {})} />
          )}

          {isStreaming && (
            <StreamingIndicator
              streamParts={streamParts}
              onStop={onStopGeneration}
              effectiveAgentName={effectiveAgentName}
              effectiveSdkBackend={effectiveSdkBackend}
            />
          )}

          {/* PI plan-approval UI — persists across turn boundaries via
              chatStore.pendingPlanApprovals until the user clicks. When
              streaming, the SAME block is also rendered inline via
              StreamingIndicator; this second render takes over once the
              stream buffer is cleaned up on 'done'. */}
          {!isStreaming && pendingPlanApproval && conversationId != null && (
            <PlanApprovalBlock
              approval={{
                type: 'plan_approval_request',
                conversationId,
                plan: pendingPlanApproval.plan,
              }}
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
