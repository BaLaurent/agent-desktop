import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { useFileExplorerStore } from '../../stores/fileExplorerStore'
import { useMobileMode } from '../../hooks/useMobileMode'
import { HtmlPreview } from '../artifacts/HtmlPreview'
import { MarkdownArtifact } from '../artifacts/MarkdownArtifact'
import { MermaidBlock } from '../artifacts/MermaidBlock'
import { ModelPreview } from '../artifacts/ModelPreview'
import { ScadPreview } from '../artifacts/ScadPreview'
import { SvgPreview } from '../artifacts/SvgPreview'
import { NotebookPreview } from '../artifacts/NotebookPreview'

interface ExpandedViewerModalProps {
  filePath: string
  content: string
  language: string | null
  allowScripts?: boolean
  initialMode: 'source' | 'preview'
  canToggle: boolean
  onChange: (value: string) => void
  onClose: () => void
}

function toMonacoLanguage(lang: string | null): string {
  if (!lang) return 'plaintext'
  const map: Record<string, string> = { bash: 'shell', svg: 'xml' }
  return map[lang] || lang
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

export function ExpandedViewerModal({
  filePath,
  content,
  language,
  allowScripts,
  initialMode,
  canToggle,
  onChange,
  onClose,
}: ExpandedViewerModalProps) {
  const [mode, setMode] = useState(initialMode)
  const mobile = useMobileMode()
  const filename = getBasename(filePath)

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

  const handleMount = (editor: any, monaco: any) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      useFileExplorerStore.getState().saveFile()
    })
  }

  const ext = getFileExtension(filePath)

  // Preview viewer
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

  // Source editor
  const editor = mobile ? (
    <div className="flex flex-col h-full">
      <div
        className="px-3 py-2 text-xs"
        style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
      >
        Monaco editor has limited mobile support. Use a simple text editor below.
      </div>
      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 w-full px-3 py-2 text-sm font-mono outline-none resize-none"
        style={{
          backgroundColor: 'var(--color-deep)',
          color: 'var(--color-text)',
        }}
        spellCheck={false}
      />
    </div>
  ) : (
    <Editor
      height="100%"
      language={toMonacoLanguage(language)}
      theme="vs-dark"
      value={content}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
      }}
    />
  )

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        className="flex flex-col w-[96vw] max-w-[1600px] rounded-lg shadow-2xl overflow-hidden compact:max-h-[100dvh] h-[92vh] compact:h-[100dvh]"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'color-mix(in srgb, var(--color-text-muted) 20%, transparent)' }}
        >
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
            {filename}
          </span>
          <div className="flex items-center gap-2">
            {canToggle && (
              <button
                onClick={() => setMode(m => m === 'source' ? 'preview' : 'source')}
                className="p-1 rounded hover:opacity-80 transition-opacity"
                style={{ color: 'var(--color-text-muted)' }}
                title={mode === 'preview' ? 'View source' : 'View preview'}
                aria-label={mode === 'preview' ? 'Switch to source view' : 'Switch to preview'}
              >
                {mode === 'preview' ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polyline points="4,2 7,2 7,6" /><polyline points="9,2 12,2 12,6" />
                    <polyline points="4,10 7,10 7,14" /><polyline points="9,10 12,10 12,14" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="3" /><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
                  </svg>
                )}
              </button>
            )}
            <button
              onClick={handleClose}
              className="w-7 h-7 mobile:w-11 mobile:h-11 flex items-center justify-center rounded hover:bg-base transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Close expanded view"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {mode === 'source' ? editor : viewer}
        </div>
      </div>
    </div>
  )
}
