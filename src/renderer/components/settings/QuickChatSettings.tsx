import { useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'

export function QuickChatSettings() {
  const { settings, setSetting } = useSettingsStore()

  const handlePurge = useCallback(async () => {
    await window.agent.quickChat.purge()
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Quick Chat lets you invoke the agent from anywhere on your desktop using global keyboard shortcuts.
        The overlay appears as a floating input over all windows.
        Configure shortcuts in the <strong>Shortcuts</strong> tab.
      </p>

      {/* Response toggles */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          Response Display
        </h4>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={settings.quickChat_responseNotification === 'true'}
            onChange={(e) => setSetting('quickChat_responseNotification', e.target.checked ? 'true' : 'false')}
            className="accent-[var(--color-primary)]"
          />
          Show desktop notification for responses
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={settings.quickChat_responseBubble === 'true'}
            onChange={(e) => setSetting('quickChat_responseBubble', e.target.checked ? 'true' : 'false')}
            className="accent-[var(--color-primary)]"
          />
          Show response bubble (voice mode)
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={settings.quickChat_voiceHeadless === 'true'}
            onChange={(e) => setSetting('quickChat_voiceHeadless', e.target.checked ? 'true' : 'false')}
            className="accent-[var(--color-primary)]"
          />
          Headless voice mode (notifications only, no overlay)
        </label>
      </div>

      {/* Voice Volume */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          Voice Volume
        </h4>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Number(settings.voice_volumeDuck) || 0}
            onChange={(e) => setSetting('voice_volumeDuck', e.target.value)}
            className="flex-1 accent-[var(--color-primary)]"
          />
          <span
            className="text-sm w-10 text-right"
            style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}
          >
            {Number(settings.voice_volumeDuck) || 0}%
          </span>
        </div>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Reduces system volume by this percentage during voice recording. 0 = disabled.
        </span>
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={settings.voice_pauseMediaPlayers === 'true'}
            onChange={(e) => setSetting('voice_pauseMediaPlayers', e.target.checked ? 'true' : 'false')}
            className="accent-[var(--color-primary)]"
          />
          Pause media players during voice recording
        </label>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Pauses currently playing media (Spotify, browsers, etc. via playerctl) while recording, and resumes them when recording stops. Linux only.
        </span>
      </div>

      {/* Conversations */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          Conversations
        </h4>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={settings.quickChat_resumeLastConversationText === 'true'}
            onChange={(e) => setSetting('quickChat_resumeLastConversationText', e.target.checked ? 'true' : 'false')}
            className="accent-[var(--color-primary)]"
          />
          Resume last user conversation (text)
        </label>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Text Quick Chat continues the most recent conversation where you sent a message (excluding dedicated Quick Chat conversations). Falls back to the dedicated Quick Chat conversation if none exists.
        </span>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={settings.quickChat_resumeLastConversationVoice === 'true'}
            onChange={(e) => setSetting('quickChat_resumeLastConversationVoice', e.target.checked ? 'true' : 'false')}
            className="accent-[var(--color-primary)]"
          />
          Resume last user conversation (voice)
        </label>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Voice Quick Chat continues the most recent conversation where you sent a message (excluding dedicated Quick Chat conversations). Falls back to the dedicated Quick Chat conversation if none exists.
        </span>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={settings.quickChat_resumePreferLastOpened === 'true'}
            onChange={(e) => setSetting('quickChat_resumePreferLastOpened', e.target.checked ? 'true' : 'false')}
            className="accent-[var(--color-primary)]"
          />
          Prefer last opened conversation
        </label>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          When a resume toggle above is active, use the most recently opened conversation (selected in the sidebar) instead of the one with the most recent user message. No effect if no resume toggle is enabled.
        </span>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input
            type="checkbox"
            checked={settings.quickChat_separateVoiceConversation === 'true'}
            onChange={(e) => setSetting('quickChat_separateVoiceConversation', e.target.checked ? 'true' : 'false')}
            className="accent-[var(--color-primary)]"
          />
          Separate conversations for text and voice
        </label>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          When enabled, voice Quick Chat uses a dedicated conversation instead of sharing with text mode. Ignored if resume is active.
        </span>
      </div>

      {/* Purge */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          History
        </h4>
        <button
          onClick={handlePurge}
          className="self-start px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 mobile:py-3"
          style={{
            backgroundColor: 'var(--color-error, #ef4444)',
            color: 'var(--color-text-contrast)',
          }}
        >
          Purge Quick Chat History
        </button>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Deletes all messages from the Quick Chat conversation. The conversation itself is kept.
        </span>
      </div>
    </div>
  )
}
