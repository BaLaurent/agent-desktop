import { useEffect, useState, useCallback } from 'react'
import { useKnowledgeStore } from '../../stores/knowledgeStore'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function KnowledgeManager() {
  const { collections, loading, loadCollections } = useKnowledgeStore()
  const [expandedCollection, setExpandedCollection] = useState<string | null>(null)
  const [collectionFiles, setCollectionFiles] = useState<{ name: string; path: string; size: number }[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  useEffect(() => {
    loadCollections()
  }, [loadCollections])

  const handleOpenFolder = useCallback(async () => {
    await window.agent.kb.openKnowledgesFolder()
  }, [])

  const handleToggleExpand = useCallback(async (name: string) => {
    if (expandedCollection === name) {
      setExpandedCollection(null)
      setCollectionFiles([])
      return
    }
    setExpandedCollection(name)
    setLoadingFiles(true)
    try {
      const files = await window.agent.kb.getCollectionFiles(name)
      setCollectionFiles(files)
    } catch (err) {
      console.error('[KnowledgeManager] getCollectionFiles failed:', err)
      setCollectionFiles([])
    } finally {
      setLoadingFiles(false)
    }
  }, [expandedCollection])

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Header with path and actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
          ~/.agent-desktop/knowledges/
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleOpenFolder}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)',
            }}
            aria-label="Open knowledges folder in file manager"
          >
            Open in File Manager
          </button>
          <button
            onClick={loadCollections}
            disabled={loading}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-80 bg-primary text-contrast"
            style={{ opacity: loading ? 0.5 : 1 }}
            aria-label="Refresh collections"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Collection list */}
      {collections.length === 0 ? (
        <div className="text-sm py-4 text-center" style={{ color: 'var(--color-text-muted)' }}>
          {loading ? 'Loading collections...' : 'No collections found. Create a sub-folder in the knowledges directory to get started.'}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {collections.map((col) => (
            <div key={col.name}>
              <button
                onClick={() => handleToggleExpand(col.name)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-opacity hover:opacity-80"
                style={{ backgroundColor: 'var(--color-deep)' }}
                aria-expanded={expandedCollection === col.name}
              >
                <svg
                  width="10" height="10" viewBox="0 0 16 16" fill="currentColor"
                  style={{
                    color: 'var(--color-text-muted)',
                    transform: expandedCollection === col.name ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.15s',
                  }}
                  aria-hidden="true"
                >
                  <path d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z" />
                </svg>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-primary)' }} aria-hidden="true">
                  <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.56 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
                </svg>
                <span className="flex-1 font-medium" style={{ color: 'var(--color-text)' }}>{col.name}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {col.fileCount} file{col.fileCount !== 1 ? 's' : ''} &middot; {formatSize(col.totalSize)}
                </span>
              </button>
              {expandedCollection === col.name && (
                <div className="ml-6 mt-1 flex flex-col gap-0.5">
                  {loadingFiles ? (
                    <div className="text-xs py-1" style={{ color: 'var(--color-text-muted)' }}>Loading files...</div>
                  ) : collectionFiles.length === 0 ? (
                    <div className="text-xs py-1" style={{ color: 'var(--color-text-muted)' }}>No supported files</div>
                  ) : (
                    collectionFiles.map((file) => (
                      <div
                        key={file.path}
                        className="flex items-center gap-2 px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: 'var(--color-surface)' }}
                      >
                        <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{file.name}</span>
                        <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{formatSize(file.size)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
