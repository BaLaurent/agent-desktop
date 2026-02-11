import { useState, useEffect } from 'react'
import type { SystemInfo, UpdateInfo } from '../../../shared/types'

export function AboutSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.agent.system.getInfo().then(setInfo).catch(() => {})
  }, [])

  const handleCheckUpdate = async () => {
    setChecking(true)
    try {
      const result = await window.agent.system.checkUpdate()
      setUpdate(result)
    } catch {
      setUpdate({ available: false })
    } finally {
      setChecking(false)
    }
  }

  const handleOpenGitHub = () => {
    window.agent.system.openExternal('https://github.com/BaLaurent/agent-desktop')
  }

  return (
    <div className="flex flex-col gap-6">
      {/* App Identity */}
      <div className="flex flex-col gap-1">
        <h2
          className="text-2xl font-bold"
          style={{ color: 'var(--color-primary)' }}
        >
          Agent Desktop
        </h2>
        <p
          className="text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Open-source Linux desktop client for Claude AI
        </p>
      </div>

      {/* System Info */}
      <div className="flex flex-col gap-2">
        <h3
          className="text-sm font-semibold"
          style={{ color: 'var(--color-text)' }}
        >
          System Information
        </h3>
        <div
          className="rounded-lg p-4 flex flex-col gap-2 text-sm"
          style={{ backgroundColor: 'var(--color-bg)' }}
        >
          <InfoRow label="Version" value={info?.version ?? '...'} />
          <InfoRow label="Electron" value={info?.electron ?? '...'} />
          <InfoRow label="Node.js" value={info?.node ?? '...'} />
          <InfoRow label="Platform" value={info?.platform ?? '...'} />
        </div>
      </div>

      {/* Updates */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={handleCheckUpdate}
            disabled={checking}
            className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 bg-primary text-contrast"
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
          {update && !update.available && (
            <span
              className="text-sm"
              style={{ color: 'var(--color-success)' }}
            >
              You are on the latest version.
            </span>
          )}
          {update?.available && (
            <span
              className="text-sm"
              style={{ color: 'var(--color-warning)' }}
            >
              Version {update.version} is available.
            </span>
          )}
        </div>
      </div>

      {/* GitHub Link */}
      <div>
        <button
          onClick={handleOpenGitHub}
          className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: 'var(--color-deep)',
            color: 'var(--color-text)',
          }}
        >
          View on GitHub
        </button>
      </div>

      {/* License */}
      <div
        className="pt-4 border-t border-[var(--color-text-muted)]/10"
      >
        <p
          className="text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Licensed under the GPL-3.0 License. This project is not affiliated with or endorsed by Anthropic.
        </p>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="font-mono" style={{ color: 'var(--color-text)' }}>
        {value}
      </span>
    </div>
  )
}
