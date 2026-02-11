import { useEffect } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'

interface ToggleOption {
  key: string
  label: string
  description: string
  defaultValue: string
}

const toggleOptions: ToggleOption[] = [
  {
    key: 'sendOnEnter',
    label: 'Send on Enter',
    description: 'Press Enter to send messages. When off, use Ctrl+Enter instead.',
    defaultValue: 'true',
  },
  {
    key: 'autoScroll',
    label: 'Auto-scroll to bottom',
    description: 'Automatically scroll to the newest message during streaming.',
    defaultValue: 'true',
  },
  {
    key: 'notificationSounds',
    label: 'Notification sounds',
    description: 'Play a sound when a response is complete.',
    defaultValue: 'true',
  },
  {
    key: 'minimizeToTray',
    label: 'Minimize to tray',
    description: 'Keep the app running in the system tray when the window is closed.',
    defaultValue: 'false',
  },
]

function Toggle({
  enabled,
  onToggle,
  label,
}: {
  enabled: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      onClick={onToggle}
      className="relative w-11 h-6 rounded-full flex-shrink-0 overflow-hidden transition-colors"
      style={{
        backgroundColor: enabled
          ? 'var(--color-primary)'
          : 'var(--color-text-muted)',
        opacity: enabled ? 1 : 0.3,
      }}
      role="switch"
      aria-checked={enabled}
      aria-label={`Toggle ${label}`}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
        style={{
          transform: enabled ? 'translateX(20px)' : 'translateX(0px)',
        }}
      />
    </button>
  )
}

export function GeneralSettings() {
  const { settings, loadSettings, setSetting } = useSettingsStore()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const getValue = (key: string, defaultValue: string): boolean =>
    (settings[key] ?? defaultValue) === 'true'

  const handleToggle = (key: string, defaultValue: string) => {
    const current = getValue(key, defaultValue)
    setSetting(key, current ? 'false' : 'true')
  }

  return (
    <div className="flex flex-col gap-1">
      {toggleOptions.map((opt) => (
        <div
          key={opt.key}
          className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10"
        >
          <div className="flex flex-col gap-0.5 pr-4">
            <span
              className="text-sm font-medium"
              style={{ color: 'var(--color-text)' }}
            >
              {opt.label}
            </span>
            <span
              className="text-xs"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {opt.description}
            </span>
          </div>
          <Toggle
            enabled={getValue(opt.key, opt.defaultValue)}
            onToggle={() => handleToggle(opt.key, opt.defaultValue)}
            label={opt.label}
          />
        </div>
      ))}
    </div>
  )
}
