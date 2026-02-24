import { useState, useEffect, useRef } from 'react'

interface Props {
  paths: string[]
  onConfirm: (method: 'copy' | 'symlink') => Promise<void>
  onClose: () => void
}

function getBasename(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx === -1 ? p : p.slice(idx + 1)
}

export function NewConversationFromFilesModal({ paths, onConfirm, onClose }: Props) {
  const [method, setMethod] = useState<'copy' | 'symlink'>('copy')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  const handleCreate = async () => {
    setLoading(true)
    setError(null)
    try {
      await onConfirm(method)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create conversation')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      role="dialog"
      aria-label="New conversation from files"
    >
      <div className="rounded-lg shadow-xl w-full max-w-md mx-4 bg-surface border border-base">
        {/* Header */}
        <div className="px-4 py-3 border-b border-base">
          <h2 className="text-sm font-medium text-body">
            New conversation with {paths.length} item{paths.length !== 1 ? 's' : ''}
          </h2>
        </div>

        {/* File list */}
        <div className="px-4 py-3">
          <div className="max-h-40 overflow-y-auto rounded border border-base bg-deep">
            {paths.map((p) => (
              <div
                key={p}
                className="px-3 py-1.5 text-xs text-muted truncate border-b border-base last:border-b-0"
                title={p}
              >
                {getBasename(p)}
              </div>
            ))}
          </div>
        </div>

        {/* Method selector */}
        <div className="px-4 pb-3">
          <label className="text-xs font-medium text-body block mb-1.5">Transfer method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as 'copy' | 'symlink')}
            className="w-full text-sm rounded px-2 py-1.5 bg-deep text-body border border-base outline-none"
          >
            <option value="copy">Copy</option>
            <option value="symlink">Symlink</option>
          </select>
          <p className="text-xs text-muted mt-1">
            {method === 'copy'
              ? 'Independent copies in session folder'
              : 'Live links to original files'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 pb-3">
            <div className="text-xs rounded px-3 py-2 bg-error text-contrast" role="alert">
              {error}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 py-3 border-t border-base flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded hover:opacity-80 transition-opacity text-muted border border-base"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded hover:opacity-80 transition-opacity bg-primary text-contrast"
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
