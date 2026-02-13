import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'

interface SystemPromptEditorModalProps {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

export function SystemPromptEditorModal({ value, onChange, onClose }: SystemPromptEditorModalProps) {
  const [draft, setDraft] = useState(value)

  const handleSave = useCallback(() => {
    onChange(draft)
    onClose()
  }, [draft, onChange, onClose])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleCancel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleCancel])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel()
      }}
    >
      <div
        className="flex flex-col w-[90vw] max-w-4xl rounded-lg shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', height: '80vh' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'color-mix(in srgb, var(--color-text-muted) 20%, transparent)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Edit System Prompt
          </span>
          <button
            onClick={handleCancel}
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
            language="markdown"
            theme="vs-dark"
            value={draft}
            onChange={(v) => setDraft(v ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              lineNumbers: 'off',
              renderLineHighlight: 'none',
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-3 border-t"
          style={{ borderColor: 'color-mix(in srgb, var(--color-text-muted) 20%, transparent)' }}
        >
          <button
            onClick={handleCancel}
            className="px-4 py-1.5 rounded text-sm transition-colors hover:opacity-80"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 rounded text-sm font-medium transition-colors"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-text-contrast)',
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
