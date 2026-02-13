import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { NOTIFICATION_EVENTS, DEFAULT_NOTIFICATION_CONFIG } from '../../../shared/constants'
import type { NotificationConfig, NotificationEvent } from '../../../shared/types'
import { ChevronDownIcon } from '../icons/ChevronDownIcon'

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

function getNotifConfig(settings: Record<string, string>): NotificationConfig {
  const raw = settings.notificationConfig
  if (!raw) return DEFAULT_NOTIFICATION_CONFIG
  try {
    return { ...DEFAULT_NOTIFICATION_CONFIG, ...(JSON.parse(raw) as Partial<NotificationConfig>) }
  } catch {
    return DEFAULT_NOTIFICATION_CONFIG
  }
}

export function GeneralSettings() {
  const { settings, loadSettings, setSetting } = useSettingsStore()
  const [showNotifDetails, setShowNotifDetails] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const getValue = (key: string, defaultValue: string): boolean =>
    (settings[key] ?? defaultValue) === 'true'

  const handleToggle = (key: string, defaultValue: string) => {
    const current = getValue(key, defaultValue)
    setSetting(key, current ? 'false' : 'true')
  }

  const notifConfig = getNotifConfig(settings)
  const masterOn = getValue('notificationSounds', 'true')

  const toggleNotifEvent = (eventKey: NotificationEvent, field: 'sound' | 'desktop') => {
    const updated: NotificationConfig = {
      ...notifConfig,
      [eventKey]: {
        ...notifConfig[eventKey],
        [field]: !notifConfig[eventKey][field],
      },
    }
    setSetting('notificationConfig', JSON.stringify(updated))
  }

  return (
    <div className="flex flex-col gap-1">
      {toggleOptions.map((opt) => (
        <div key={opt.key}>
          <div
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

          {opt.key === 'notificationSounds' && masterOn && (
            <div className="pl-2 pb-2">
              <button
                onClick={() => setShowNotifDetails(!showNotifDetails)}
                className="flex items-center gap-1 py-2 text-xs font-medium cursor-pointer"
                style={{ color: 'var(--color-primary)' }}
                aria-expanded={showNotifDetails}
                aria-label="Customize notifications"
              >
                <span
                  className="transition-transform"
                  style={{ transform: showNotifDetails ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                >
                  <ChevronDownIcon size={14} />
                </span>
                Customize notifications
              </button>

              {showNotifDetails && (
                <div
                  className="rounded-lg p-3 mt-1"
                  style={{ backgroundColor: 'var(--color-surface)' }}
                >
                  <div
                    className="grid gap-x-4 gap-y-2 text-xs"
                    style={{ gridTemplateColumns: '1fr auto auto' }}
                  >
                    <span style={{ color: 'var(--color-text-muted)' }}>Event</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>Sound</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>Desktop</span>

                    {NOTIFICATION_EVENTS.map((evt) => (
                      <div key={evt.key} className="contents">
                        <span style={{ color: 'var(--color-text)' }}>{evt.label}</span>
                        <div className="flex justify-center">
                          <Toggle
                            enabled={notifConfig[evt.key as NotificationEvent].sound}
                            onToggle={() => toggleNotifEvent(evt.key as NotificationEvent, 'sound')}
                            label={`${evt.label} sound`}
                          />
                        </div>
                        <div className="flex justify-center">
                          <Toggle
                            enabled={notifConfig[evt.key as NotificationEvent].desktop}
                            onToggle={() => toggleNotifEvent(evt.key as NotificationEvent, 'desktop')}
                            label={`${evt.label} desktop`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--color-text-muted)]/10">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                        Desktop notification trigger
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        When to show desktop notifications
                      </span>
                    </div>
                    <select
                      value={settings.notificationDesktopMode ?? 'unfocused'}
                      onChange={(e) => setSetting('notificationDesktopMode', e.target.value)}
                      className="text-xs rounded px-2 py-1 border border-[var(--color-text-muted)]/20"
                      style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-text)' }}
                      aria-label="Desktop notification trigger mode"
                    >
                      <option value="hidden">Hidden only</option>
                      <option value="unfocused">Unfocused</option>
                      <option value="always">Always</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
