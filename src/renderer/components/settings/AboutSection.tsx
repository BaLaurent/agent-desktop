import { useState, useEffect } from 'react'
import type { SystemInfo, UpdateStatus } from '../../../shared/types'

export function AboutSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    window.agent.system.getInfo().then(setInfo).catch(() => {})
    window.agent.updates.getStatus().then(setStatus).catch(() => {})
    const unsubscribe = window.agent.updates.onStatus(setStatus)
    return unsubscribe
  }, [])

  const handleCheckUpdate = async () => {
    try {
      const result = await window.agent.updates.check()
      if (!result.available) {
        setStatus({ state: 'not-available' })
      }
    } catch {
      setStatus({ state: 'error', message: 'Failed to check for updates' })
    }
  }

  const handleDownload = async () => {
    try {
      await window.agent.updates.download()
    } catch (err) {
      setStatus({ state: 'error', message: err instanceof Error ? err.message : 'Download failed' })
    }
  }

  const handleInstall = () => {
    window.agent.updates.install()
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
        <UpdateSection
          status={status}
          onCheck={handleCheckUpdate}
          onDownload={handleDownload}
          onInstall={handleInstall}
        />
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

function UpdateSection({
  status,
  onCheck,
  onDownload,
  onInstall,
}: {
  status: UpdateStatus
  onCheck: () => void
  onDownload: () => void
  onInstall: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {(status.state === 'idle' || status.state === 'not-available' || status.state === 'error') && (
          <button
            onClick={onCheck}
            className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 bg-primary text-contrast"
          >
            Check for Updates
          </button>
        )}
        {status.state === 'checking' && (
          <button
            disabled
            className="px-4 py-2 rounded text-sm font-medium opacity-50 bg-primary text-contrast"
          >
            Checking...
          </button>
        )}
        {status.state === 'available' && (
          <button
            onClick={onDownload}
            className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 bg-primary text-contrast"
          >
            Download Update
          </button>
        )}
        {status.state === 'downloading' && (
          <button
            disabled
            className="px-4 py-2 rounded text-sm font-medium opacity-50 bg-primary text-contrast"
          >
            Downloading...
          </button>
        )}
        {status.state === 'downloaded' && (
          <button
            onClick={onInstall}
            className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 bg-primary text-contrast"
          >
            Restart to Install
          </button>
        )}

        {/* Status messages */}
        {status.state === 'not-available' && (
          <span className="text-sm" style={{ color: 'var(--color-success)' }}>
            You are on the latest version.
          </span>
        )}
        {status.state === 'available' && (
          <span className="text-sm" style={{ color: 'var(--color-warning)' }}>
            Version {status.version} is available.
          </span>
        )}
        {status.state === 'downloaded' && (
          <span className="text-sm" style={{ color: 'var(--color-success)' }}>
            Version {status.version} ready to install.
          </span>
        )}
        {status.state === 'error' && (
          <span className="text-sm" style={{ color: 'var(--color-warning)' }}>
            {status.message}
          </span>
        )}
      </div>

      {/* Download progress bar */}
      {status.state === 'downloading' && (
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ backgroundColor: 'var(--color-bg)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${Math.round(status.percent)}%`,
              backgroundColor: 'var(--color-primary)',
            }}
          />
        </div>
      )}
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
