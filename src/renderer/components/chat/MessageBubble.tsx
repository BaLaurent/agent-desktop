import { useState, useCallback, useMemo } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolCallsSection } from './ToolCallsSection'
import { TaskFormModal } from '../scheduler/TaskFormModal'
import { ContextMenu, ContextMenuItem } from '../shared/ContextMenu'
import { useTtsStore } from '../../stores/ttsStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useMobileMode } from '../../hooks/useMobileMode'
import type { Message, CreateScheduledTask } from '../../../shared/types'

interface MessageBubbleProps {
  message: Message
  isLast: boolean
  onEdit?: (messageId: number, content: string) => void
  onRegenerate?: () => void
  onFork?: (messageId: number) => void
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

export function MessageBubble({ message, isLast, onEdit, onRegenerate, onFork }: MessageBubbleProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [showActions, setShowActions] = useState(false)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const mobile = useMobileMode()

  const isUser = message.role === 'user'
  const sendOnEnter = useSettingsStore((s) => s.settings.sendOnEnter ?? 'true')

  // Extract hook system messages from saved content (wrapped in <hook-system-message> tags)
  const { hookMessages, cleanContent } = useMemo(() => {
    if (isUser) return { hookMessages: [] as string[], cleanContent: message.content }
    const hooks: string[] = []
    const cleaned = message.content.replace(
      /<hook-system-message>([\s\S]*?)<\/hook-system-message>\n?/g,
      (_, content: string) => { hooks.push(content); return '' }
    )
    return { hookMessages: hooks, cleanContent: cleaned.replace(/^\n+/, '') }
  }, [message.content, isUser])

  const speakingMessageId = useTtsStore((s) => s.speakingMessageId)
  const { playMessage, stopPlayback } = useTtsStore()
  const ttsProvider = useSettingsStore((s) => s.settings.tts_provider)
  const ttsResponseMode = useSettingsStore((s) => s.settings.tts_responseMode)
  const isSpeakingThis = speakingMessageId === message.id
  const showTtsButton = !isUser && !!ttsProvider && ttsProvider !== 'off'
    && !!ttsResponseMode && ttsResponseMode !== 'off'

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(isUser ? message.content : cleanContent)
  }, [message.content, isUser, cleanContent])

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

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
      return
    }
    if (sendOnEnter === 'false') {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSaveEdit()
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSaveEdit()
      }
    }
  }, [sendOnEnter, handleSaveEdit, handleCancelEdit])

  const handleScheduleSave = useCallback(async (data: CreateScheduledTask) => {
    await window.agent.scheduler.create(data)
  }, [])

  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isEditing) return
    e.preventDefault()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }, [isEditing])

  return (
    <div
      className={`flex min-w-0 ${isUser ? 'justify-end' : 'justify-start'} mb-4 group`}
      onMouseEnter={mobile ? undefined : () => setShowActions(true)}
      onMouseLeave={mobile ? undefined : () => setShowActions(false)}
      onClick={mobile ? () => { if (!isEditing) setShowActions(prev => !prev) } : undefined}
    >
      <div
        className={`rounded-lg px-4 py-3 relative max-w-[80%] compact:max-w-[95%] ${
          isEditing ? 'w-full' : ''
        } ${
          isUser ? 'rounded-br-sm' : 'rounded-bl-sm'
        }`}
        style={{
          backgroundColor: isUser ? 'var(--color-deep)' : 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
        onContextMenu={handleContextMenu}
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
              onKeyDown={handleEditKeyDown}
              className="w-full rounded p-2 resize-none text-sm mobile:text-base"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-text-muted)',
              }}
              rows={Math.max(3, editContent.split('\n').length + 1)}
              autoFocus
            />
            <div className="flex gap-2 mt-2 mobile:flex-wrap">
              <button
                onClick={handleSaveEdit}
                className="rounded font-medium bg-primary text-contrast px-3 py-1 text-xs mobile:px-4 mobile:py-3 mobile:text-sm"
              >
                Save & Send
              </button>
              <button
                onClick={handleCancelEdit}
                className="rounded px-3 py-1 text-xs mobile:px-4 mobile:py-3 mobile:text-sm"
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
                {hookMessages.map((hm, i) => (
                  <div
                    key={`hook_${i}`}
                    className="mb-2 rounded px-3 py-2 text-xs border"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    <MarkdownRenderer content={hm} />
                  </div>
                ))}
                <MarkdownRenderer content={cleanContent} />
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
        {(showActions || isSpeakingThis) && !isEditing && (
          <div
            className="absolute -top-3 right-2 flex rounded shadow-md gap-1 px-1 py-0.5 mobile:gap-2 mobile:px-1.5 mobile:py-1 mobile:flex-wrap"
            style={{ backgroundColor: 'var(--color-deep)' }}
          >
            <button
              onClick={handleCopy}
              className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[10px] mobile:px-4 mobile:py-3 mobile:text-sm"
              style={{ color: 'var(--color-text-muted)' }}
              title="Copy"
            >
              Copy
            </button>
            {showTtsButton && (
              <button
                onClick={() => isSpeakingThis ? stopPlayback() : playMessage(message.id, isUser ? message.content : cleanContent, message.conversation_id)}
                className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[10px] mobile:px-4 mobile:py-3 mobile:text-sm"
                style={{ color: isSpeakingThis ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                title={isSpeakingThis ? 'Stop TTS' : 'Play TTS'}
              >
                {isSpeakingThis ? 'Stop' : 'Play'}
              </button>
            )}
            {isUser && onEdit && (
              <button
                onClick={handleStartEdit}
                className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[10px] mobile:px-4 mobile:py-3 mobile:text-sm"
                style={{ color: 'var(--color-text-muted)' }}
                title="Edit"
              >
                Edit
              </button>
            )}
            {isUser && onEdit && (
              <button
                onClick={() => onEdit(message.id, message.content)}
                className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[10px] mobile:px-4 mobile:py-3 mobile:text-sm"
                style={{ color: 'var(--color-text-muted)' }}
                title="Retry this message"
              >
                Retry
              </button>
            )}
            {isUser && (
              <button
                onClick={() => setShowTaskForm(true)}
                className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[10px] mobile:px-4 mobile:py-3 mobile:text-sm"
                style={{ color: 'var(--color-text-muted)' }}
                title="Schedule as recurring task"
              >
                Schedule
              </button>
            )}
            {!isUser && isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[10px] mobile:px-4 mobile:py-3 mobile:text-sm"
                style={{ color: 'var(--color-text-muted)' }}
                title="Regenerate"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {showTaskForm && (
        <TaskFormModal
          initialPrompt={message.content}
          initialConversationId={message.conversation_id}
          onSave={handleScheduleSave}
          onClose={() => setShowTaskForm(false)}
        />
      )}

      {showContextMenu && (
        <ContextMenu position={contextMenuPos} onClose={() => setShowContextMenu(false)} className="min-w-[140px]" aria-label="Message actions">
          <ContextMenuItem onClick={() => { setShowContextMenu(false); handleCopy() }}>
            Copy
          </ContextMenuItem>
          {showTtsButton && (
            <ContextMenuItem onClick={() => {
              setShowContextMenu(false)
              isSpeakingThis ? stopPlayback() : playMessage(message.id, isUser ? message.content : cleanContent, message.conversation_id)
            }}>
              {isSpeakingThis ? 'Stop TTS' : 'Play TTS'}
            </ContextMenuItem>
          )}
          {isUser && onEdit && (
            <ContextMenuItem onClick={() => { setShowContextMenu(false); handleStartEdit() }}>
              Edit
            </ContextMenuItem>
          )}
          {isUser && onEdit && (
            <ContextMenuItem onClick={() => { setShowContextMenu(false); onEdit(message.id, message.content) }}>
              Retry
            </ContextMenuItem>
          )}
          {isUser && (
            <ContextMenuItem onClick={() => { setShowContextMenu(false); setShowTaskForm(true) }}>
              Schedule
            </ContextMenuItem>
          )}
          {!isUser && isLast && onRegenerate && (
            <ContextMenuItem onClick={() => { setShowContextMenu(false); onRegenerate() }}>
              Retry
            </ContextMenuItem>
          )}
          {onFork && (
            <ContextMenuItem onClick={() => { setShowContextMenu(false); onFork(message.id) }}>
              Fork from here
            </ContextMenuItem>
          )}
        </ContextMenu>
      )}
    </div>
  )
}
