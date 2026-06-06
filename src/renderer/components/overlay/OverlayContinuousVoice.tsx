import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useContinuousVoice, useContinuousVoiceStore } from '../../services/continuousVoice'
import { OverlayResponse } from './OverlayResponse'

const PHASE_LABEL: Record<string, string> = {
  idle: 'Starting…',
  listening: 'Listening…',
  speaking: "You're speaking…",
  transcribing: 'Transcribing…',
  error: 'Error',
}

const IGNORE_LABEL: Record<string, string> = {
  'no-wakeword': 'Ignored — say the wake word first',
  'not-addressed': "Ignored — didn't sound like you were talking to me",
  'classify-error': 'Voice check unavailable — ignored',
  empty: 'Ignored — nothing to send',
}

/** Continuous-voice surface for the overlay: keeps listening while showing AI responses. */
export function OverlayContinuousVoice({ conversationId }: { conversationId: number }) {
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const phase = useContinuousVoiceStore((s) => s.phase)
  const error = useContinuousVoiceStore((s) => s.error)
  const lastIgnored = useContinuousVoiceStore((s) => s.lastIgnored)

  const [lastResponse, setLastResponse] = useState('')
  const prevStreamingRef = useRef(false)

  const { start, notifyExchangeComplete, levelRef } = useContinuousVoice({
    conversationId,
    onSend: (text) => {
      setLastResponse('')
      sendMessage(conversationId, text)
    },
  })

  useEffect(() => {
    start()
    // hook handles teardown on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (streamingContent) setLastResponse(streamingContent)
  }, [streamingContent])

  // Falling edge of streaming → open the follow-up window.
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) notifyExchangeComplete()
    prevStreamingRef.current = isStreaming
  }, [isStreaming, notifyExchangeComplete])

  // Level meter: read the ref on rAF, bypassing React state churn.
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (barRef.current) {
        const pct = Math.min(100, Math.round(levelRef.current * 600))
        barRef.current.style.width = `${pct}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [levelRef])

  const showIgnored = lastIgnored && Date.now() - lastIgnored.at < 2500

  return (
    <div className="flex flex-col gap-2 px-4 py-3 flex-1 overflow-hidden">
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{
            backgroundColor: phase === 'speaking' ? 'var(--color-primary, #6366f1)' : 'rgba(255,255,255,0.4)',
            animation: phase === 'listening' ? 'pulse 1.5s ease-in-out infinite' : undefined,
          }}
        />
        <span className="text-sm" style={{ color: 'var(--color-text, #eee)' }}>
          {error || PHASE_LABEL[phase] || 'Listening…'}
        </span>
      </div>

      <div className="h-1 rounded overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
        <div ref={barRef} className="h-full" style={{ width: '0%', backgroundColor: 'var(--color-primary, #6366f1)' }} />
      </div>

      {showIgnored && (
        <span className="text-xs" style={{ color: 'var(--color-text-muted, #888)' }}>
          {IGNORE_LABEL[lastIgnored!.reason] || 'Ignored'}
        </span>
      )}

      {(streamingContent || lastResponse) && (
        <div className="flex-1 overflow-y-auto">
          <OverlayResponse content={streamingContent || lastResponse} />
        </div>
      )}
    </div>
  )
}
