import { useState, useEffect, useRef, useMemo } from 'react'

interface Props {
  paths: string[]
  onConfirm: (method: 'copy' | 'symlink', renames: Record<string, string>) => Promise<void>
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

  // names: Record<path, displayName> — initialized from basenames
  const [names, setNames] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const p of paths) init[p] = getBasename(p)
    return init
  })
  const [editingPath, setEditingPath] = useState<string | null>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingPath) {
          setEditingPath(null)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, editingPath])

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  // Validation: no empty names, no path separators, no case-insensitive duplicates
  const validationError = useMemo(() => {
    const allNames = Object.values(names)
    for (const n of allNames) {
      if (n.trim() === '') return 'File name cannot be empty'
      if (n.includes('/') || n.includes('\\')) return 'File name cannot contain path separators'
    }
    const lower = allNames.map(n => n.trim().toLowerCase())
    const unique = new Set(lower)
    if (unique.size !== lower.length) return 'Duplicate file names are not allowed'
    return null
  }, [names])

  const handleCreate = async () => {
    if (validationError) return
    setLoading(true)
    setError(null)
    try {
      // Build renames map with only changed entries
      const renames: Record<string, string> = {}
      for (const p of paths) {
        const original = getBasename(p)
        const current = names[p]?.trim()
        if (current && current !== original) {
          renames[p] = current
        }
      }
      await onConfirm(method, renames)
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
            {paths.map((p) => {
              const original = getBasename(p)
              const current = names[p] ?? original
              const isRenamed = current.trim() !== original
              const isEditing = editingPath === p

              return (
                <div
                  key={p}
                  className="px-3 py-1.5 text-xs border-b border-base last:border-b-0 flex items-center gap-1.5"
                  title={p}
                >
                  {isEditing ? (
                    <EditableFileName
                      value={current}
                      onChange={(val) => setNames(prev => ({ ...prev, [p]: val }))}
                      onDone={() => setEditingPath(null)}
                    />
                  ) : (
                    <span
                      className="truncate cursor-pointer text-muted hover:text-body transition-colors"
                      onClick={(e) => { e.stopPropagation(); setEditingPath(p) }}
                      role="button"
                      aria-label={`Rename ${current}`}
                    >
                      {current}
                    </span>
                  )}
                  {isRenamed && !isEditing && (
                    <span className="text-[10px] px-1 py-0.5 rounded flex-shrink-0 bg-accent text-contrast">
                      renamed
                    </span>
                  )}
                </div>
              )
            })}
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

        {/* Validation error */}
        {validationError && (
          <div className="px-4 pb-3">
            <div className="text-xs rounded px-3 py-2 bg-warning" style={{ color: '#000' }} role="alert">
              {validationError}
            </div>
          </div>
        )}

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
            disabled={loading || validationError !== null}
            className="px-3 py-1.5 text-sm rounded hover:opacity-80 transition-opacity bg-primary text-contrast"
            style={{ opacity: (loading || validationError) ? 0.6 : 1 }}
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditableFileName({ value, onChange, onDone }: {
  value: string
  onChange: (val: string) => void
  onDone: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    const dot = value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : value.length)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    if (doneRef.current) return
    doneRef.current = true
    onDone()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      commit()
    }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      className="text-xs rounded px-1 outline-none flex-1 min-w-0 bg-deep text-body border border-primary"
      aria-label="Edit file name"
    />
  )
}
