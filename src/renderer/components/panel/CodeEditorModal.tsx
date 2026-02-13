import { useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { useFileExplorerStore } from '../../stores/fileExplorerStore'

interface CodeEditorModalProps {
  value: string
  onChange: (value: string) => void
  onClose: () => void
  language: string | null
  filename: string
}

function toMonacoLanguage(lang: string | null): string {
  if (!lang) return 'plaintext'
  const map: Record<string, string> = { bash: 'shell', svg: 'xml' }
  return map[lang] || lang
}

export function CodeEditorModal({ value, onChange, onClose, language, filename }: CodeEditorModalProps) {
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
            aria-label="Close editor"
          >
            ✕
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 min-h-0">
          <Editor
            height="100%"
            language={toMonacoLanguage(language)}
            theme="vs-dark"
            value={value}
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
        </div>
      </div>
    </div>
  )
}
