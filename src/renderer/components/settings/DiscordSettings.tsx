import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'

interface DiscordStatus {
  connected: boolean
  username?: string
  guildCount?: number
}

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      onClick={onToggle}
      className="relative w-11 h-6 rounded-full flex-shrink-0 overflow-hidden transition-colors"
      style={{
        backgroundColor: enabled ? 'var(--color-primary)' : 'var(--color-text-muted)',
        opacity: enabled ? 1 : 0.3,
      }}
      role="switch"
      aria-checked={enabled}
      aria-label={label}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
        style={{ transform: enabled ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  )
}

export function DiscordSettings() {
  const { settings, setSetting } = useSettingsStore()
  const [status, setStatus] = useState<DiscordStatus>({ connected: false })
  const [tokenInput, setTokenInput] = useState(settings.discord_botToken || '')
  const [showToken, setShowToken] = useState(false)
  const [whitelistInput, setWhitelistInput] = useState(() => {
    try {
      const parsed = JSON.parse(settings.discord_userWhitelist || '[]') as string[]
      return parsed.join(', ')
    } catch {
      return ''
    }
  })

  const isEnabled = settings.discord_enabled === 'true'

  const fetchStatus = useCallback(async () => {
    try {
      const s = await window.agent.discord.status()
      setStatus(s)
    } catch {
      // IPC might not exist yet
    }
  }, [])

  // Poll status when enabled
  useEffect(() => {
    fetchStatus()
    if (!isEnabled) return
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [isEnabled, fetchStatus])

  const handleToggle = async () => {
    if (isEnabled) {
      try {
        await window.agent.discord.disconnect()
      } catch {}
      await setSetting('discord_enabled', 'false')
    } else {
      await setSetting('discord_enabled', 'true')
      await setSetting('discord_botToken', tokenInput.trim())
      try {
        await window.agent.discord.connect()
      } catch (err) {
        console.error('[discord] Connect failed:', err)
      }
    }
    fetchStatus()
  }

  const handleTokenBlur = async () => {
    await setSetting('discord_botToken', tokenInput.trim())
  }

  const handleWhitelistBlur = async () => {
    const ids = whitelistInput
      .split(/[,\s]+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    await setSetting('discord_userWhitelist', JSON.stringify(ids))
  }

  const handleConnect = async () => {
    try {
      await window.agent.discord.connect()
    } catch (err) {
      console.error('[discord] Connect failed:', err)
    }
    fetchStatus()
  }

  const handleDisconnect = async () => {
    try {
      await window.agent.discord.disconnect()
    } catch (err) {
      console.error('[discord] Disconnect failed:', err)
    }
    fetchStatus()
  }

  return (
    <div className="space-y-6">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Enable Discord Bot
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Connect a Discord bot to interact with Agent Desktop via slash commands.
          </div>
        </div>
        <Toggle enabled={isEnabled} onToggle={handleToggle} label="Enable Discord bot" />
      </div>

      {/* Bot Token */}
      <div>
        <label className="text-sm font-medium block mb-1" style={{ color: 'var(--color-text)' }}>
          Bot Token
        </label>
        <div className="flex items-center gap-2">
          <input
            type={showToken ? 'text' : 'password'}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onBlur={handleTokenBlur}
            disabled={status.connected}
            placeholder="Paste your Discord bot token"
            className="flex-1 mobile:w-full px-3 py-1.5 rounded text-sm mobile:text-base border"
            style={{
              backgroundColor: 'var(--color-base)',
              color: 'var(--color-text)',
              borderColor: 'var(--color-text-muted)',
              opacity: status.connected ? 0.5 : 1,
            }}
            aria-label="Bot token"
          />
          <button
            onClick={() => setShowToken(!showToken)}
            className="text-xs px-2 py-1.5 mobile:text-sm mobile:px-3 mobile:py-2 rounded"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Get a bot token from the Discord Developer Portal.
        </div>
      </div>

      {/* Allowed Users */}
      <div>
        <label className="text-sm font-medium block mb-1" style={{ color: 'var(--color-text)' }}>
          Allowed User IDs
        </label>
        <input
          type="text"
          value={whitelistInput}
          onChange={(e) => setWhitelistInput(e.target.value)}
          onBlur={handleWhitelistBlur}
          placeholder="123456789, 987654321"
          className="w-full px-3 py-1.5 rounded text-sm mobile:text-base border"
          style={{
            backgroundColor: 'var(--color-base)',
            color: 'var(--color-text)',
            borderColor: 'var(--color-text-muted)',
          }}
          aria-label="Allowed user IDs"
        />
        <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
          Comma-separated Discord user IDs. Leave empty to allow everyone.
        </div>
      </div>

      {/* Connection Status */}
      <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-base)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: status.connected ? '#22c55e' : 'var(--color-text-muted)' }}
            />
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {status.connected
                ? `Connected as ${status.username}`
                : 'Disconnected'}
            </span>
          </div>
          {isEnabled && (
            status.connected ? (
              <button
                onClick={handleDisconnect}
                className="text-xs px-3 py-1.5 mobile:text-sm mobile:px-4 mobile:py-2 rounded"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                className="text-xs px-3 py-1.5 mobile:text-sm mobile:px-4 mobile:py-2 rounded"
                style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
              >
                Connect
              </button>
            )
          )}
        </div>
        {status.connected && status.guildCount !== undefined && (
          <div className="text-xs mt-2" style={{ color: 'var(--color-text-muted)' }}>
            Active in {status.guildCount} server{status.guildCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="text-xs space-y-1" style={{ color: 'var(--color-text-muted)' }}>
        <p>The Discord bot provides slash commands to interact with your conversations.</p>
        <p>Available commands: /set-conversation, /get-messages, /send-message, /new-conversation</p>
      </div>
    </div>
  )
}
