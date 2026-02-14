import { useEffect, useRef, useState } from 'react'
import { useVoiceInputStore } from '../../stores/voiceInputStore'

interface OverlayVoiceProps {
  onTranscription: (text: string) => void
}

export function OverlayVoice({ onTranscription }: OverlayVoiceProps) {
  const { isRecording, isTranscribing, error, lastTranscription, startRecording, stopAndTranscribe, cancelRecording } = useVoiceInputStore()
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const handledIdRef = useRef<number>(0)

  // Auto-start recording on mount
  useEffect(() => {
    startRecording()
    return () => {
      cancelRecording()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRecording])

  // Forward transcription to parent
  useEffect(() => {
    if (lastTranscription && lastTranscription.id !== handledIdRef.current) {
      handledIdRef.current = lastTranscription.id
      onTranscription(lastTranscription.text)
    }
  }, [lastTranscription, onTranscription])

  // Listen for overlay:stopRecording event from main process
  useEffect(() => {
    const unsub = window.agent.events.onOverlayStopRecording(() => {
      if (isRecording) stopAndTranscribe()
    })
    return unsub
  }, [isRecording, stopAndTranscribe])

  const handleClick = () => {
    if (isRecording) {
      stopAndTranscribe()
    }
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-4">
      {/* Pulsing mic icon */}
      <button
        onClick={handleClick}
        className="w-16 h-16 rounded-full flex items-center justify-center transition-all"
        style={{
          backgroundColor: isRecording
            ? 'var(--color-error, #ef4444)'
            : 'var(--color-primary, #6366f1)',
          animation: isRecording ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
        aria-label={isRecording ? 'Stop recording' : 'Microphone'}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
      </button>

      {/* Status text */}
      <div className="text-sm" style={{ color: 'var(--color-text-muted, #888)' }}>
        {isRecording && (
          <span>Recording {formatTime(elapsed)} — click or press Escape to stop</span>
        )}
        {isTranscribing && <span>Transcribing...</span>}
        {error && (
          <span style={{ color: 'var(--color-error, #ef4444)' }}>{error}</span>
        )}
      </div>

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.85; }
        }
      `}</style>
    </div>
  )
}
