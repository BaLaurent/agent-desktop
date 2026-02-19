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
      </div>

      {/* Conversations */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          Conversations
        </h4>

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
          When enabled, voice Quick Chat uses a dedicated conversation instead of sharing with text mode.
        </span>
      </div>

      {/* Purge */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
          History
        </h4>
        <button
          onClick={handlePurge}
          className="self-start px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: 'var(--color-error, #ef4444)',
            color: '#fff',
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
