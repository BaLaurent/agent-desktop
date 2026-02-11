import { useState, useEffect } from 'react'
import type { SystemInfo } from '../../../shared/types'

type ConfirmTarget = null | 'conversations' | 'all'

export function StorageSettings() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [cleared, setCleared] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null)
  const [purging, setPurging] = useState(false)
  const [purgeResult, setPurgeResult] = useState<string | null>(null)

  useEffect(() => {
    window.agent.system.getInfo().then(setInfo).catch(() => {})
  }, [])

  const handleClearCache = async () => {
    setClearing(true)
    try {
      await window.agent.system.clearCache()
      setCleared(true)
      setTimeout(() => setCleared(false), 3000)
    } catch {
      // silent
    } finally {
      setClearing(false)
    }
  }

  const handlePurge = async () => {
    if (!confirmTarget) return
    setPurging(true)
    setPurgeResult(null)
    try {
      if (confirmTarget === 'conversations') {
        const result = await window.agent.system.purgeConversations()
        setPurgeResult(
          `Purged ${result.conversations} conversation${result.conversations !== 1 ? 's' : ''} and ${result.folders} folder${result.folders !== 1 ? 's' : ''}.`
        )
      } else {
        const result = await window.agent.system.purgeAll()
        setPurgeResult(
          `Full reset complete. ${result.conversations} conversation${result.conversations !== 1 ? 's' : ''} removed.`
        )
      }
    } catch {
      setPurgeResult('Purge failed.')
    } finally {
      setPurging(false)
      setConfirmTarget(null)
      setTimeout(() => setPurgeResult(null), 5000)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Database Location */}
      <div>
        <h3
          className="text-sm font-semibold mb-2"
          style={{ color: 'var(--color-text)' }}
        >
          Database Location
        </h3>
        <div
          className="px-3 py-2 rounded text-sm font-mono select-all"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-text-muted)',
            opacity: 0.3,
          }}
        >
          {info?.dbPath ?? 'Loading...'}
        </div>
        <p
          className="text-xs mt-1"
          style={{ color: 'var(--color-text-muted)' }}
        >
          SQLite database file containing all conversations and settings.
        </p>
      </div>

      {/* Config Path */}
      <div>
        <h3
          className="text-sm font-semibold mb-2"
          style={{ color: 'var(--color-text)' }}
        >
          Config Directory
        </h3>
        <div
          className="px-3 py-2 rounded text-sm font-mono select-all"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-text-muted)',
            opacity: 0.3,
          }}
        >
          {info?.configPath ?? 'Loading...'}
        </div>
      </div>

      {/* Clear Cache */}
      <div className="flex flex-col gap-2">
        <h3
          className="text-sm font-semibold"
          style={{ color: 'var(--color-text)' }}
        >
          Application Logs
        </h3>
        <p
          className="text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Clear cached data and application logs to free up space.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleClearCache}
            disabled={clearing}
            className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 bg-error text-contrast"
          >
            {clearing ? 'Clearing...' : 'Clear Application Logs'}
          </button>
          {cleared && (
            <span
              className="text-sm"
              style={{ color: 'var(--color-success)' }}
            >
              Cleared successfully.
            </span>
          )}
        </div>
      </div>

      {/* Danger Zone */}
      <div
        className="flex flex-col gap-3 p-4 rounded-lg border"
        style={{ borderColor: 'var(--color-error)', opacity: 0.85 }}
      >
        <h3
          className="text-sm font-semibold"
          style={{ color: 'var(--color-error)' }}
        >
          Danger Zone
        </h3>

        {/* Purge Conversations */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Purge All Conversations
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Deletes all conversations, messages, and folders. Settings and auth are preserved.
            </p>
          </div>
          {confirmTarget === 'conversations' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePurge}
                disabled={purging}
                className="px-3 py-1.5 rounded text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 bg-error text-contrast"
              >
                {purging ? 'Purging...' : 'Confirm'}
              </button>
              <button
                onClick={() => setConfirmTarget(null)}
                disabled={purging}
                className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-text-muted)',
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmTarget('conversations')}
              disabled={purging}
              className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50 shrink-0"
              style={{
                color: 'var(--color-error)',
                border: '1px solid var(--color-error)',
                backgroundColor: 'transparent',
              }}
            >
              Purge Conversations
            </button>
          )}
        </div>

        {/* Reset All */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Reset All Data
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Removes everything: conversations, folders, KB files, MCP servers, themes, and shortcuts. Only auth and settings are kept.
            </p>
          </div>
          {confirmTarget === 'all' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePurge}
                disabled={purging}
                className="px-3 py-1.5 rounded text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 bg-error text-contrast"
              >
                {purging ? 'Resetting...' : 'Confirm'}
              </button>
              <button
                onClick={() => setConfirmTarget(null)}
                disabled={purging}
                className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-text-muted)',
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmTarget('all')}
              disabled={purging}
              className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50 shrink-0"
              style={{
                color: 'var(--color-error)',
                border: '1px solid var(--color-error)',
                backgroundColor: 'transparent',
              }}
            >
              Reset All Data
            </button>
          )}
        </div>

        {purgeResult && (
          <p
            className="text-xs mt-1"
            style={{ color: purgeResult.includes('failed') ? 'var(--color-error)' : 'var(--color-success)' }}
          >
            {purgeResult}
          </p>
        )}
      </div>
    </div>
  )
}
