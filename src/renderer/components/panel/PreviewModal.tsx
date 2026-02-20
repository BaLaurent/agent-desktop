import { useEffect, useCallback } from 'react'
import { HtmlPreview } from '../artifacts/HtmlPreview'
import { MarkdownArtifact } from '../artifacts/MarkdownArtifact'
import { MermaidBlock } from '../artifacts/MermaidBlock'
import { ModelPreview } from '../artifacts/ModelPreview'
import { ScadPreview } from '../artifacts/ScadPreview'
import { SvgPreview } from '../artifacts/SvgPreview'
import { NotebookPreview } from '../artifacts/NotebookPreview'

interface PreviewModalProps {
  filePath: string
  content: string
  language: string | null
  allowScripts?: boolean
  onClose: () => void
}

function getFileExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return ''
  return filePath.slice(dot + 1).toLowerCase()
}

function getBasename(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx === -1 ? filePath : filePath.slice(idx + 1)
}

const MODEL_EXTENSIONS = new Set(['stl', 'obj', '3mf', 'ply'])

export function PreviewModal({ filePath, content, language, allowScripts, onClose }: PreviewModalProps) {
  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleClose])

  const ext = getFileExtension(filePath)
  const filename = getBasename(filePath)

  let viewer: React.ReactNode
  if (language === 'model' || MODEL_EXTENSIONS.has(ext)) {
    viewer = <ModelPreview filePath={filePath} content={content} />
  } else if (language === 'image') {
    viewer = (
      <div className="h-full w-full overflow-auto flex items-center justify-center p-4">
        <img
          src={content}
          alt={filename}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          draggable={false}
        />
      </div>
    )
  } else if (ext === 'svg') {
    viewer = <SvgPreview content={content} />
  } else if (ext === 'html' || ext === 'htm') {
    viewer = <HtmlPreview filePath={filePath} allowScripts={allowScripts} />
  } else if (ext === 'md' || ext === 'markdown') {
    viewer = <MarkdownArtifact content={content} />
  } else if (ext === 'mmd') {
    viewer = (
      <div className="h-full overflow-auto p-4 flex justify-center">
        <MermaidBlock content={content} />
      </div>
    )
  } else if (ext === 'scad') {
    viewer = <ScadPreview filePath={filePath} lastSavedAt={0} />
  } else if (ext === 'ipynb') {
    viewer = <NotebookPreview content={content} filePath={filePath} />
  } else {
    viewer = (
      <div className="h-full flex items-center justify-center text-sm text-muted">
        No preview available
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        className="flex flex-col w-[96vw] max-w-[1600px] rounded-lg shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', height: '92vh' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'color-mix(in srgb, var(--color-text-muted) 20%, transparent)' }}
        >
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
            {filename}
          </span>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-base transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>

        {/* Preview content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {viewer}
        </div>
      </div>
    </div>
  )
}
