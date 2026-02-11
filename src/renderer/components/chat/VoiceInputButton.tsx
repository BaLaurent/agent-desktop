import { useCallback, useEffect, useRef, useState } from 'react'
import { useVoiceInputStore } from '../../stores/voiceInputStore'

interface VoiceInputButtonProps {
  disabled: boolean
}

export function VoiceInputButton({ disabled }: VoiceInputButtonProps) {
  const { isRecording, isTranscribing, error, toggleRecording, clearError } = useVoiceInputStore()
  const [showError, setShowError] = useState(false)
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  // Show error tooltip when error changes
  useEffect(() => {
    if (error) {
      setShowError(true)
      clearTimeout(errorTimeoutRef.current)
      errorTimeoutRef.current = setTimeout(() => setShowError(false), 5000)
    } else {
      setShowError(false)
    }
    return () => clearTimeout(errorTimeoutRef.current)
  }, [error])

  const handleClick = useCallback(() => {
    if (disabled || isTranscribing) return
    if (showError) {
      clearError()
      setShowError(false)
      return
    }
    toggleRecording()
  }, [disabled, isTranscribing, showError, clearError, toggleRecording])

  const buttonColor = isRecording
    ? 'var(--color-error)'
    : isTranscribing
      ? 'var(--color-primary)'
      : 'var(--color-deep)'

  const textColorClass = isRecording || isTranscribing ? 'text-contrast' : 'text-muted'

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-all hover:opacity-80 ${textColorClass}`}
        style={{
          backgroundColor: buttonColor,
          opacity: disabled ? 0.4 : 1,
          animation: isRecording ? 'tool-pulse 1.5s ease-in-out infinite' : undefined,
        }}
        title={
          isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Voice input (mic)'
        }
        aria-label={
          isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing audio' : 'Start voice input'
        }
      >
        {isTranscribing ? (
          // Spinner
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
            <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
          </svg>
        ) : (
          // Mic icon (Feather-style)
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
            <path d="M19 10v2a7 7 0 01-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>

      {/* Error tooltip */}
      {showError && error && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-md text-xs max-w-[280px] whitespace-normal shadow-lg cursor-pointer z-50 bg-error text-contrast"
          onClick={() => {
            clearError()
            setShowError(false)
          }}
          role="alert"
        >
          {error}
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid var(--color-error)',
            }}
          />
        </div>
      )}
    </div>
  )
}
