import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useMobileMode } from '../../hooks/useMobileMode'

interface ServerStatus {
  running: boolean
  port: number | null
  url: string | null
  urlHostname: string | null
  lanIp: string | null
  hostname: string | null
  token: string | null
  clients: number
  firewallWarning: string | null
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

export function WebServerSettings() {
  const { settings, setSetting } = useSettingsStore()
  const mobile = useMobileMode()
  const [status, setStatus] = useState<ServerStatus>({ running: false, port: null, url: null, urlHostname: null, lanIp: null, hostname: null, token: null, clients: 0, firewallWarning: null })
  const [portInput, setPortInput] = useState(settings.server_port || '3484')
  const [showToken, setShowToken] = useState(false)
  const [qrSvg, setQrSvg] = useState<string>('')

  const isEnabled = settings.server_enabled === 'true'
  const autoStart = settings.server_autoStart === 'true'

  const fetchStatus = useCallback(async () => {
    try {
      const s = await window.agent.server.getStatus()
      setStatus(s)
    } catch {
      // server IPC might not exist yet
    }
  }, [])

  // Poll status when running
  useEffect(() => {
    fetchStatus()
    if (!isEnabled) return
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [isEnabled, fetchStatus])

  // Generate QR code when URL changes
  useEffect(() => {
    if (!status.url) {
      setQrSvg('')
      return
    }
    import('qrcode').then((QRCode) => {
      QRCode.toString(status.url!, { type: 'svg', margin: 1 }, (err: Error | null | undefined, svg: string) => {
        if (!err) setQrSvg(svg)
      })
    }).catch(() => {})
  }, [status.url])

  const handleToggle = async () => {
    if (isEnabled) {
      try {
        await window.agent.server.stop()
      } catch {}
      await setSetting('server_enabled', 'false')
    } else {
      const port = parseInt(portInput, 10) || 3484
      try {
        await window.agent.server.start(port)
      } catch (err) {
        console.error('[webServer] Start failed:', err)
        return
      }
      await setSetting('server_enabled', 'true')
      await setSetting('server_port', String(port))
    }
    fetchStatus()
  }

  const handleAutoStartToggle = async () => {
    await setSetting('server_autoStart', autoStart ? 'false' : 'true')
  }

  const copyToken = () => {
    if (status.token) {
      navigator.clipboard.writeText(status.token).catch(() => {})
    }
  }

  const copyUrl = () => {
    if (status.url) {
      navigator.clipboard.writeText(status.url).catch(() => {})
    }
  }

  return (
    <div className="space-y-6">
      {/* Server toggle */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Enable Web Server
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Access Agent Desktop from your phone or other devices on the same network.
          </div>
        </div>
        <Toggle enabled={isEnabled} onToggle={handleToggle} label="Enable web server" />
      </div>

      {/* Port */}
      <div>
        <label className="text-sm font-medium block mb-1" style={{ color: 'var(--color-text)' }}>
          Port
        </label>
        <input
          type="number"
          value={portInput}
          onChange={(e) => setPortInput(e.target.value)}
          disabled={isEnabled}
          min={1024}
          max={65535}
          className={`${mobile ? 'w-full' : 'w-32'} px-3 py-1.5 rounded ${mobile ? 'text-base' : 'text-sm'} border`}
          style={{
            backgroundColor: 'var(--color-base)',
            color: 'var(--color-text)',
            borderColor: 'var(--color-text-muted)',
            opacity: isEnabled ? 0.5 : 1,
          }}
        />
        <span className="text-xs ml-2" style={{ color: 'var(--color-text-muted)' }}>
          Default: 3484
        </span>
      </div>

      {/* Auto-start */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Auto-start on launch
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            Automatically start the web server when Agent Desktop opens.
          </div>
        </div>
        <Toggle enabled={autoStart} onToggle={handleAutoStartToggle} label="Auto-start web server" />
      </div>

      {/* Status section — only when running */}
      {status.running && (
        <div className="space-y-4 p-4 rounded-lg" style={{ backgroundColor: 'var(--color-base)' }}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Server running — {status.clients} client{status.clients !== 1 ? 's' : ''} connected
            </span>
          </div>

          {/* Firewall warning */}
          {status.firewallWarning && (
            <div
              className="p-3 rounded-lg text-sm space-y-2"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-text)' }}
            >
              <div className="font-medium">Firewall may be blocking remote access</div>
              <pre
                className="text-xs whitespace-pre-wrap p-2 rounded"
                style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text-muted)' }}
              >
                {status.firewallWarning}
              </pre>
            </div>
          )}

          {/* URL by IP */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-text-muted)' }}>
              URL (LAN IP: {status.lanIp})
            </label>
            <div className="flex items-center gap-2">
              <code
                className="text-xs px-2 py-1 rounded flex-1 truncate"
                style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
              >
                {status.url}
              </code>
              <button
                onClick={copyUrl}
                className={`${mobile ? 'text-sm px-3 py-2' : 'text-xs px-2 py-1'} rounded`}
                style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
              >
                Copy
              </button>
            </div>
          </div>

          {/* URL by hostname */}
          {status.urlHostname && (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-text-muted)' }}>
                URL (hostname: {status.hostname})
              </label>
              <div className="flex items-center gap-2">
                <code
                  className="text-xs px-2 py-1 rounded flex-1 truncate"
                  style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
                >
                  {status.urlHostname}
                </code>
                <button
                  onClick={() => {
                    if (status.urlHostname) navigator.clipboard.writeText(status.urlHostname).catch(() => {})
                  }}
                  className={`${mobile ? 'text-sm px-3 py-2' : 'text-xs px-2 py-1'} rounded`}
                  style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {/* Token */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-text-muted)' }}>
              Token
            </label>
            <div className="flex items-center gap-2">
              <code
                className="text-xs px-2 py-1 rounded flex-1 truncate"
                style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
              >
                {showToken ? status.token : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
              </code>
              <button
                onClick={() => setShowToken(!showToken)}
                className={`${mobile ? 'text-sm px-3 py-2' : 'text-xs px-2 py-1'} rounded`}
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
              <button
                onClick={copyToken}
                className={`${mobile ? 'text-sm px-3 py-2' : 'text-xs px-2 py-1'} rounded`}
                style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
              >
                Copy
              </button>
            </div>
          </div>

          {/* QR Code */}
          {qrSvg && (
            <div>
              <label className="text-xs font-medium block mb-2" style={{ color: 'var(--color-text-muted)' }}>
                Scan with your phone
              </label>
              <div
                className={`${mobile ? 'w-64 h-64 max-w-full' : 'w-48 h-48'} p-2 rounded-lg`}
                style={{ backgroundColor: '#ffffff' }}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="text-xs space-y-1" style={{ color: 'var(--color-text-muted)' }}>
        <p>The web server serves the same interface over your local network.</p>
        <p>TTS and voice input play on the PC, not the remote device.</p>
        <p>File dialogs (select folder/file) are not available in browser mode.</p>
      </div>
    </div>
  )
}
