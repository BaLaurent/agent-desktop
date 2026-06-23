import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useConversationsStore } from '../../stores/conversationsStore'
import { NOTIFICATION_EVENTS, DEFAULT_NOTIFICATION_CONFIG } from '../../../shared/constants'
import type { NotificationConfig, NotificationEvent } from '../../../shared/types'
import { ChevronDownIcon } from '../icons/ChevronDownIcon'
import { tint } from '../../utils/colorMix'
import { Toggle } from '../shared/Toggle'
import { SettingRow } from '../shared/SettingRow'

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
  const loadFolders = useConversationsStore((s) => s.loadFolders)
  const loadConversations = useConversationsStore((s) => s.loadConversations)
  const [showNotifDetails, setShowNotifDetails] = useState(false)

  const reseedGuides = async () => {
    try {
      const { created } = await window.agent.guides.reseed()
      // Refresh both: reseed inserts folders AND their guide conversations.
      await Promise.all([loadFolders(), loadConversations()])
      window.alert(
        created > 0
          ? `${created} guide folder(s) recreated.`
          : 'All guide folders are already present.',
      )
    } catch (err) {
      window.alert(`Error: ${(err as Error).message}`)
    }
  }

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
            className="flex items-center justify-between py-3 border-b"
            style={{ borderColor: tint('--color-text-muted', 10) }}
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
              ariaLabel={`Toggle ${opt.label}`}
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
                            ariaLabel={`Toggle ${evt.label} sound`}
                          />
                        </div>
                        <div className="flex justify-center">
                          <Toggle
                            enabled={notifConfig[evt.key as NotificationEvent].desktop}
                            onToggle={() => toggleNotifEvent(evt.key as NotificationEvent, 'desktop')}
                            label={`${evt.label} desktop`}
                            ariaLabel={`Toggle ${evt.label} desktop`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div
                    className="flex items-center justify-between mt-3 pt-3 border-t"
                    style={{ borderColor: tint('--color-text-muted', 10) }}
                  >
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
                      className="text-xs rounded px-2 py-1 border mobile:text-base mobile:py-2"
                      style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-text)', borderColor: tint('--color-text-muted', 20) }}
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

      {/* Auto-retry settings */}
      <SettingRow label="Auto-retry on error" description="Automatically retry when a streaming response fails (e.g. SDK crash).">
        <Toggle
          enabled={getValue('retry_enabled', 'true')}
          onToggle={() => handleToggle('retry_enabled', 'true')}
          label="Auto-retry on error"
        />
      </SettingRow>

      {getValue('retry_enabled', 'true') && (
        <>
          <SettingRow label="Max retry attempts" description="Number of times to retry before giving up (1–10).">
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={settings.retry_maxAttempts ?? '3'}
              onChange={(e) => {
                const val = Math.max(1, Math.min(10, Number(e.target.value) || 3))
                setSetting('retry_maxAttempts', String(val))
              }}
              className="w-24 text-sm rounded px-2 py-1 border text-right mobile:text-base"
              style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-text)', borderColor: tint('--color-text-muted', 20) }}
              aria-label="Max retry attempts"
            />
          </SettingRow>

          <SettingRow label="Initial retry delay" description="Seconds before first retry. Doubles on each subsequent attempt (1–30).">
            <input
              type="number"
              min={1}
              max={30}
              step={1}
              value={Math.round(Number(settings.retry_initialDelayMs ?? '2000') / 1000)}
              onChange={(e) => {
                const seconds = Math.max(1, Math.min(30, Number(e.target.value) || 2))
                setSetting('retry_initialDelayMs', String(seconds * 1000))
              }}
              className="w-24 text-sm rounded px-2 py-1 border text-right mobile:text-base"
              style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-text)', borderColor: tint('--color-text-muted', 20) }}
              aria-label="Initial retry delay in seconds"
            />
          </SettingRow>
        </>
      )}

      {/* Default sort order */}
      <SettingRow label="Default conversation sort" description="How conversations and folders are sorted in the sidebar.">
        <div className="flex items-center gap-2">
          <select
            value={settings.sort_criterion ?? 'updated_at'}
            onChange={(e) => setSetting('sort_criterion', e.target.value)}
            className="text-xs rounded px-2 py-1 border mobile:text-base mobile:py-2"
            style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-text)', borderColor: tint('--color-text-muted', 20) }}
            aria-label="Sort criterion"
          >
            <option value="updated_at">Last message date</option>
            <option value="message_count">Message count</option>
            <option value="title">Alphabetical</option>
          </select>
          <select
            value={settings.sort_direction ?? 'desc'}
            onChange={(e) => setSetting('sort_direction', e.target.value)}
            className="text-xs rounded px-2 py-1 border mobile:text-base mobile:py-2"
            style={{ backgroundColor: 'var(--color-base)', color: 'var(--color-text)', borderColor: tint('--color-text-muted', 20) }}
            aria-label="Sort direction"
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
      </SettingRow>

      {/* Guide folders */}
      <SettingRow
        label="Guide folders"
        description="Recreate the Macros, Functions and Themes folders with their guide. Folders already present are kept."
      >
        <button
          onClick={reseedGuides}
          className="text-xs rounded px-2 py-1 border mobile:text-base mobile:py-2"
        >
          Recreate
        </button>
      </SettingRow>
    </div>
  )
}
