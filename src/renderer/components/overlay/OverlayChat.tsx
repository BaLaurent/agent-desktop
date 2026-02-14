import { useEffect, useState, useCallback, useRef } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { playListeningSound, playProcessingSound } from '../../utils/notificationSound'
import { OverlayInput } from './OverlayInput'
import { OverlayResponse } from './OverlayResponse'
import { OverlayVoice } from './OverlayVoice'

interface OverlayChatProps {
  voiceMode: boolean
}

export function OverlayChat({ voiceMode }: OverlayChatProps) {
  const [headless] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return p.get('headless') === 'true'
  })
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [voiceSent, setVoiceSent] = useState(false)
  const [lastResponse, setLastResponse] = useState('')
  const prevStreamingRef = useRef(false)

  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const error = useChatStore((s) => s.error)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const setActiveConversation = useChatStore((s) => s.setActiveConversation)

  // Initialize: load settings, apply theme, get conversation ID
  useEffect(() => {
    const init = async () => {
      const settingsStore = useSettingsStore.getState()
      await settingsStore.loadSettings()
      await settingsStore.loadThemes()

      const { themes, activeTheme } = useSettingsStore.getState()
      if (activeTheme) {
        const theme = themes.find((t) => t.filename === activeTheme)
        if (theme) settingsStore.applyTheme(theme)
      } else if (themes.length > 0) {
        settingsStore.applyTheme(themes[0])
      }

      const { settings } = useSettingsStore.getState()
      if (settings.fontSize) {
        document.documentElement.style.fontSize = settings.fontSize + 'px'
      }

      const id = await window.agent.quickChat.getConversationId(voiceMode ? 'voice' : 'text')
      setConversationId(id)
      setActiveConversation(id)
      setReady(true)
    }
    init()
  }, [setActiveConversation])

  // Headless: notify "Listening..." on mount
  useEffect(() => {
    if (!headless || !voiceMode) return
    playListeningSound()
    window.agent.system.showNotification('Quick Chat', 'Listening...').catch(() => {})
  }, [headless, voiceMode])

  // Headless: notify "Processing..." when voice recording stops
  useEffect(() => {
    if (!headless || !voiceSent) return
    playProcessingSound()
    window.agent.system.showNotification('Quick Chat', 'Processing...').catch(() => {})
  }, [headless, voiceSent])

  // Escape key → hide overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.agent.quickChat.hide()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Capture last non-empty streaming content for bubble persistence
  useEffect(() => {
    if (streamingContent) {
      setLastResponse(streamingContent)
    }
  }, [streamingContent])

  // Stream completion → notification (both modes) + bubble (voice-only)
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const settings = useSettingsStore.getState().settings
      const responseContent = streamingContent || lastResponse

      // Notification: fires for both text and voice modes
      if (settings.quickChat_responseNotification === 'true' && responseContent) {
        const preview = responseContent.slice(0, 100) + (responseContent.length > 100 ? '...' : '')
        window.agent.system.showNotification('Quick Chat', preview).catch(() => {})
      }

      // Headless: auto-hide after response
      if (headless) {
        window.agent.quickChat.hide().catch(() => {})
      }

      // Bubble repositioning: voice-only (non-headless)
      if (!headless && voiceMode && voiceSent && settings.quickChat_responseBubble === 'true') {
        window.agent.quickChat.setBubbleMode().catch(() => {})
      }
    }
    prevStreamingRef.current = isStreaming
  }, [isStreaming, voiceMode, voiceSent, streamingContent, lastResponse])

  const handleSend = useCallback(
    (text: string) => {
      if (!conversationId) return
      setLastResponse('')
      sendMessage(conversationId, text)
    },
    [conversationId, sendMessage]
  )

  const handleVoiceTranscription = useCallback(
    (text: string) => {
      if (!conversationId || !text.trim()) return
      setLastResponse('')
      setVoiceSent(true)
      sendMessage(conversationId, text.trim())
    },
    [conversationId, sendMessage]
  )

  if (!ready) {
    return (
      <div
        className="w-screen h-screen rounded-xl flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
      >
        <div
          className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--color-primary, #6366f1)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  return (
    <div
      className="w-screen h-screen rounded-xl flex flex-col overflow-hidden"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      {/* Header bar with drag region */}
      <div
        className="flex items-center justify-between px-4 py-2 text-xs select-none"
        style={{
          color: 'var(--color-text-muted, #888)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <span>Quick Chat</span>
        <button
          onClick={() => window.agent.quickChat.hide()}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
          style={{ color: 'var(--color-text-muted, #888)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          aria-label="Close overlay"
        >
          <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
            <path d="M1.05 1.05a.5.5 0 01.707 0L7 6.293l5.243-5.243a.5.5 0 11.707.707L7.707 7l5.243 5.243a.5.5 0 11-.707.707L7 7.707l-5.243 5.243a.5.5 0 01-.707-.707L6.293 7 1.05 1.757a.5.5 0 010-.707z" />
          </svg>
        </button>
      </div>

      {/* Separator */}
      <div className="h-px" style={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }} />

      {/* Content area */}
      {voiceMode && !voiceSent ? (
        <OverlayVoice onTranscription={handleVoiceTranscription} />
      ) : (
        <>
          <OverlayInput onSend={handleSend} isStreaming={isStreaming} />
          <div className="h-px" style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)' }} />
          <OverlayResponse content={streamingContent || lastResponse} />
        </>
      )}

      {/* Error display */}
      {error && (
        <div
          className="px-4 py-2 text-xs"
          style={{ color: 'var(--color-error, #ef4444)' }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
