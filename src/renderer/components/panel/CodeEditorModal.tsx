import { useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { useFileExplorerStore } from '../../stores/fileExplorerStore'
import { useMobileMode } from '../../hooks/useMobileMode'

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
  const mobile = useMobileMode()
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
        className={`flex flex-col w-[96vw] max-w-[1600px] rounded-lg shadow-2xl overflow-hidden ${mobile ? 'max-h-[100dvh]' : ''}`}
        style={{ backgroundColor: 'var(--color-surface)', height: mobile ? '100dvh' : '92vh' }}
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
            className={`${mobile ? 'w-11 h-11' : 'w-7 h-7'} flex items-center justify-center rounded hover:bg-base transition-colors`}
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Close editor"
          >
            ✕
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 min-h-0">
          {mobile ? (
            <div className="flex flex-col h-full">
              <div
                className="px-3 py-2 text-xs"
                style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
              >
                Monaco editor has limited mobile support. Use a simple text editor below.
              </div>
              <textarea
                value={value}
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
          )}
        </div>
      </div>
    </div>
  )
}
