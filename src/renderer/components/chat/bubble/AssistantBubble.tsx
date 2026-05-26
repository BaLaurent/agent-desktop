import { useState, useCallback, useMemo } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { ToolCallsSection } from '../ToolCallsSection'
import { BubbleActions } from './BubbleActions'
import { ThinkingBlock } from './ThinkingBlock'
import { useAgentDisplayName } from '../../../hooks/useAgentDisplayName'
import { useMobileMode } from '../../../hooks/useMobileMode'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useTtsStore } from '../../../stores/ttsStore'
import { parseDbTimestamp } from '../../../utils/dbTime'
import type { Message, CreateScheduledTask } from '../../../../shared/types'

type Segment = { kind: 'thinking' | 'text'; text: string }

/** Split content into ordered segments preserving interleaved order.
 *  Caller must have already extracted <hook-system-message> blocks. */
function splitThinkingSegments(content: string): Segment[] {
  const segments: Segment[] = []
  const re = /<thinking>([\s\S]*?)<\/thinking>\n?/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ kind: 'text', text: content.slice(lastIndex, m.index) })
    }
    segments.push({ kind: 'thinking', text: m[1] })
    lastIndex = re.lastIndex
  }
  if (lastIndex < content.length) {
    segments.push({ kind: 'text', text: content.slice(lastIndex) })
  }
  // Drop empty text segments — thinking tags often touch surrounding text
  return segments.filter((s) => s.kind === 'thinking' || s.text.length > 0)
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = parseDbTimestamp(dateStr).getTime()
  const diffSec = Math.floor((now - then) / 1000)

  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

export interface AssistantBubbleProps {
  message: Message
  isLast: boolean
  effectiveTtsResponseMode?: string
  effectiveAgentName?: string
  effectiveSdkBackend?: string
  onRegenerate?: () => void
  onFork?: (messageId: number) => void
}

export function AssistantBubble({
  message,
  isLast,
  effectiveTtsResponseMode,
  effectiveAgentName,
  effectiveSdkBackend,
  onRegenerate,
  onFork,
}: AssistantBubbleProps) {
  const [showActions, setShowActions] = useState(false)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [copiedPos, setCopiedPos] = useState<{ x: number; y: number } | null>(null)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [selectedText, setSelectedText] = useState('')

  const mobile = useMobileMode()
  const ttsProvider = useSettingsStore((s) => s.settings.tts_provider)
  const globalTtsResponseMode = useSettingsStore((s) => s.settings.tts_responseMode)
  const showThinking = useSettingsStore((s) => s.settings.ai_showThinking) === 'true'
  const speakingMessageId = useTtsStore((s) => s.speakingMessageId)
  const { playMessage, stopPlayback } = useTtsStore()
  const agentName = useAgentDisplayName(effectiveAgentName, effectiveSdkBackend)

  const isSpeakingThis = speakingMessageId === message.id
  const ttsMode = effectiveTtsResponseMode ?? globalTtsResponseMode
  const showTtsButton = !!ttsProvider && ttsProvider !== 'off' && !!ttsMode && ttsMode !== 'off'

  const { hookMessages, segments, plainTextContent } = useMemo(() => {
    const hooks: string[] = []
    const cleaned = message.content.replace(
      /<hook-system-message>([\s\S]*?)<\/hook-system-message>\n?/g,
      (_, content: string) => { hooks.push(content); return '' },
    ).replace(/^\n+/, '')
    const segs = splitThinkingSegments(cleaned)
    const plain = segs.filter((s) => s.kind === 'text').map((s) => s.text).join('').trim()
    return { hookMessages: hooks, segments: segs, plainTextContent: plain }
  }, [message.content])

  const handleCopy = useCallback(async (e?: React.MouseEvent) => {
    await navigator.clipboard.writeText(plainTextContent)
    const x = e?.clientX ?? 0
    const y = e?.clientY ?? 0
    setCopiedPos({ x, y })
    setTimeout(() => setCopiedPos(null), 1500)
  }, [plainTextContent])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const sel = window.getSelection()
    setSelectedText(sel && sel.toString().trim() ? sel.toString() : '')
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }, [])

  const handleSaveTask = useCallback(async (data: CreateScheduledTask) => {
    await window.agent.scheduler.create(data)
  }, [])

  return (
    <div
      className="flex min-w-0 justify-start mb-4 group"
      onMouseEnter={mobile ? undefined : () => setShowActions(true)}
      onMouseLeave={mobile ? undefined : () => setShowActions(false)}
      onClick={mobile ? () => setShowActions(prev => !prev) : undefined}
    >
      <div
        className="rounded-lg px-4 py-3 relative max-w-[80%] compact:max-w-[95%] rounded-bl-sm"
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
        onContextMenu={handleContextMenu}
      >
        <div
          className="text-xs font-medium mb-1"
          style={{ color: 'var(--color-accent)' }}
        >
          {agentName}
        </div>

        <div className="text-sm">
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
          {segments.map((seg, i) =>
            seg.kind === 'thinking'
              ? (showThinking ? <ThinkingBlock key={`seg_${i}`} content={seg.text} /> : null)
              : <MarkdownRenderer key={`seg_${i}`} content={seg.text} />,
          )}
          {message.tool_calls && (
            <ToolCallsSection toolCallsJson={message.tool_calls} />
          )}
        </div>

        {message.stopped ? (
          <div
            className="text-[0.625rem] mt-1 flex items-center gap-1 select-none"
            style={{ color: 'var(--color-warning)' }}
          >
            <span aria-hidden>⏹</span> Interrupted
          </div>
        ) : null}

        <div
          className="text-[0.625rem] mt-2 select-none"
          style={{ color: 'var(--color-text-muted)' }}
          title={parseDbTimestamp(message.created_at).toLocaleString()}
        >
          {formatRelativeTime(message.created_at)}
        </div>

        <BubbleActions
          message={message}
          isUser={false}
          isLast={isLast}
          showActions={showActions}
          isSpeakingThis={isSpeakingThis}
          showTtsButton={showTtsButton}
          isEditing={false}
          onCopy={handleCopy}
          copiedPos={copiedPos}
          onPlayTts={() => playMessage(message.id, plainTextContent, message.conversation_id)}
          onStopTts={stopPlayback}
          onRegenerate={onRegenerate}
          onFork={onFork}
          showTaskForm={showTaskForm}
          onOpenTaskForm={() => setShowTaskForm(true)}
          onCloseTaskForm={() => setShowTaskForm(false)}
          onSaveTask={handleSaveTask}
          showContextMenu={showContextMenu}
          contextMenuPos={contextMenuPos}
          selectedText={selectedText}
          onCloseContextMenu={() => setShowContextMenu(false)}
          onCopySelection={async (text, e) => {
            await navigator.clipboard.writeText(text)
            setCopiedPos({ x: e.clientX, y: e.clientY })
            setTimeout(() => setCopiedPos(null), 1500)
          }}
        />
      </div>
    </div>
  )
}
