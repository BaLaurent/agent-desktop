import { useEffect, useRef } from 'react'
import type { FileNode } from '../../../shared/types'
import { fuzzyMatch, fuzzyHighlight } from '../../utils/fuzzyMatch'

export interface FlatFile {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
}

export function flattenFileTree(nodes: FileNode[], basePath: string): FlatFile[] {
  const result: FlatFile[] = []
  const prefix = basePath.endsWith('/') ? basePath : basePath + '/'

  function walk(items: FileNode[]) {
    for (const node of items) {
      if (node.isDirectory) {
        if (node.children) walk(node.children)
      } else {
        result.push({
          name: node.name,
          path: node.path,
          relativePath: node.path.startsWith(prefix) ? node.path.slice(prefix.length) : node.name,
          isDirectory: false,
        })
      }
    }
  }

  walk(nodes)
  result.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return result
}

interface FileMentionDropdownProps {
  files: FlatFile[]
  filter: string
  selectedIndex: number
  onSelect: (file: FlatFile) => void
  onClose: () => void
}

export function FileMentionDropdown({ files, filter, selectedIndex, onSelect, onClose }: FileMentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  const filtered = filter
    ? files
        .map((f) => ({ file: f, ...fuzzyMatch(filter, f.relativePath) }))
        .filter((r) => r.match)
        .sort((a, b) => b.score - a.score)
        .map((r) => ({ ...r.file, _indices: r.indices }))
    : files.map((f) => ({ ...f, _indices: [] as number[] }))

  // Scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Click-outside to close
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  if (filtered.length === 0) {
    return (
      <div
        ref={listRef}
        className="absolute bottom-full left-0 mb-1 rounded shadow-lg text-xs min-w-[280px] py-2 px-3 z-50"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-text-muted)',
          color: 'var(--color-text-muted)',
        }}
      >
        No files found
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 mb-1 rounded shadow-lg text-xs min-w-[280px] max-h-[240px] overflow-y-auto py-1 z-50"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-text-muted)',
      }}
      role="listbox"
      aria-label="File mentions"
    >
      {filtered.map((file, i) => {
        const isSelected = i === selectedIndex
        return (
          <button
            key={file.path}
            ref={isSelected ? selectedRef : undefined}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(file)}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors truncate"
            style={{
              backgroundColor: isSelected ? 'var(--color-bg)' : 'transparent',
              color: 'var(--color-text)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 opacity-50" aria-hidden="true">
              <path d="M3.75 1.5a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V4.664a.25.25 0 00-.073-.177l-2.914-2.914a.25.25 0 00-.177-.073H3.75z" />
            </svg>
            <span className="truncate">
              {filter && file._indices.length > 0 ? fuzzyHighlight(file.relativePath, file._indices) : file.relativePath}
            </span>
          </button>
        )
      })}
    </div>
  )
}

