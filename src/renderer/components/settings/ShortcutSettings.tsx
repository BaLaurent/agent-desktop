import { useState, useEffect, useCallback } from 'react'
import { useShortcutsStore } from '../../stores/shortcutsStore'

function formatActionName(action: string): string {
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function keyEventToAccelerator(e: KeyboardEvent): string | null {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const key = e.key
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null

  if (key.length === 1) {
    parts.push(key.toUpperCase())
  } else if (key === 'Escape') {
    return null
  } else {
    parts.push(key)
  }

  return parts.join('+')
}

const DEFAULT_KEYBINDINGS: Record<string, string> = {
  new_conversation: 'CommandOrControl+N',
  send_message: 'Enter',
  stop_generation: 'Escape',
  toggle_sidebar: 'CommandOrControl+B',
  toggle_panel: 'CommandOrControl+J',
  focus_search: 'CommandOrControl+K',
  settings: 'CommandOrControl+,',
  voice_input: 'CommandOrControl+Shift+V',
}

export function ShortcutSettings() {
  const { shortcuts, loadShortcuts, updateShortcut } = useShortcutsStore()
  const [recordingId, setRecordingId] = useState<number | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)

  useEffect(() => {
    loadShortcuts()
  }, [loadShortcuts])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (recordingId === null) return

      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecordingId(null)
        setConflict(null)
        return
      }

      const accelerator = keyEventToAccelerator(e)
      if (!accelerator) return

      const existing = shortcuts.find(
        (s) => s.keybinding === accelerator && s.id !== recordingId
      )
      if (existing) {
        setConflict(formatActionName(existing.action))
        return
      }

      updateShortcut(recordingId, accelerator)
      setRecordingId(null)
      setConflict(null)
    },
    [recordingId, shortcuts, updateShortcut]
  )

  useEffect(() => {
    if (recordingId !== null) {
      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [recordingId, handleKeyDown])

  return (
    <div className="flex flex-col gap-4">
      {/* Table */}
      <div className="flex flex-col">
        {/* Header */}
        <div
          className="flex items-center py-2 border-b border-[var(--color-text-muted)]/20 text-xs font-medium"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <span className="flex-1">Action</span>
          <span className="w-48">Keybinding</span>
          <span className="w-20 text-right">Edit</span>
        </div>

        {/* Rows */}
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.id}
            className="flex items-center py-3 border-b border-[var(--color-text-muted)]/10"
          >
            <span
              className="flex-1 text-sm"
              style={{ color: 'var(--color-text)' }}
            >
              {formatActionName(shortcut.action)}
            </span>
            <span className="w-48">
              {recordingId === shortcut.id ? (
                <span className="flex flex-col gap-1">
                  <span
                    className="text-xs italic"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    Press a key combination...
                  </span>
                  {conflict && (
                    <span
                      className="text-xs"
                      style={{ color: 'var(--color-warning)' }}
                    >
                      Conflicts with: {conflict}
                    </span>
                  )}
                </span>
              ) : (
                <span
                  className="inline-block px-2 py-1 rounded text-xs font-mono"
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-text-muted)',
                    opacity: 0.3,
                  }}
                >
                  {shortcut.keybinding}
                </span>
              )}
            </span>
            <span className="w-20 text-right">
              <button
                onClick={() => {
                  setConflict(null)
                  setRecordingId(
                    recordingId === shortcut.id ? null : shortcut.id
                  )
                }}
                className={`px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 ${
                  recordingId === shortcut.id
                    ? 'bg-warning text-contrast'
                    : 'bg-deep text-body'
                }`}
              >
                {recordingId === shortcut.id ? 'Cancel' : 'Record'}
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* Reset button */}
      <div className="pt-2">
        <button
          className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: 'var(--color-deep)',
            color: 'var(--color-text)',
          }}
          onClick={async () => {
            for (const shortcut of shortcuts) {
              const defaultKey = DEFAULT_KEYBINDINGS[shortcut.action]
              if (defaultKey && shortcut.keybinding !== defaultKey) {
                await updateShortcut(shortcut.id, defaultKey)
              }
            }
          }}
        >
          Reset All to Defaults
        </button>
      </div>
    </div>
  )
}
