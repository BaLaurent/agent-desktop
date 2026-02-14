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
