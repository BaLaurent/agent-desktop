import { useEffect, useRef } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useContinuousVoice, useContinuousVoiceStore } from '../../services/continuousVoice'

const PHASE_LABEL: Record<string, string> = {
  idle: 'Starting…',
  listening: 'Listening…',
  speaking: "You're speaking…",
  transcribing: 'Transcribing…',
  error: 'Error',
}

/** Compact continuous-voice toggle bar for the main chat view (mirrors the overlay session). */
export function ContinuousVoiceControl({ conversationId }: { conversationId: number }) {
  const isStreaming = useChatStore((s) => s.isStreaming)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const active = useContinuousVoiceStore((s) => s.active)
  const phase = useContinuousVoiceStore((s) => s.phase)
  const error = useContinuousVoiceStore((s) => s.error)
  const prevStreamingRef = useRef(false)

  const { start, stop, notifyExchangeComplete } = useContinuousVoice({
    conversationId,
    onSend: (text) => sendMessage(conversationId, text),
  })

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) notifyExchangeComplete()
    prevStreamingRef.current = isStreaming
  }, [isStreaming, notifyExchangeComplete])

  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 text-xs"
      style={{ backgroundColor: 'var(--color-deep)', borderBottom: '1px solid var(--color-base)' }}
    >
      <button
        onClick={() => (active ? stop() : start())}
        className="px-2.5 py-1 rounded font-medium transition-opacity hover:opacity-80"
        style={{
          backgroundColor: active ? 'var(--color-primary)' : 'var(--color-base)',
          color: active ? 'var(--color-base)' : 'var(--color-text)',
        }}
        aria-pressed={active}
      >
        {active ? '■ Stop continuous voice' : '● Start continuous voice'}
      </button>
      {active && (
        <span style={{ color: 'var(--color-text-muted)' }}>{error || PHASE_LABEL[phase] || 'Listening…'}</span>
      )}
    </div>
  )
}
