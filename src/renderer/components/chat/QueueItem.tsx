import { useState, useCallback, useRef } from 'react'

interface QueueItemProps {
  id: string
  content: string
  index: number
  onEdit: (id: string, newContent: string) => void
  onDelete: (id: string) => void
  onDragStart: (index: number, e: React.MouseEvent) => void
}

export function QueueItem({ id, content, index, onEdit, onDelete, onDragStart }: QueueItemProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(content)
  const inputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)

  const handleEditClick = useCallback(() => {
    setEditValue(content)
    setEditing(true)
    savingRef.current = false
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [content])

  const handleSave = useCallback(() => {
    if (savingRef.current) return
    savingRef.current = true
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== content) {
      onEdit(id, trimmed)
    }
    setEditing(false)
  }, [editValue, content, id, onEdit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }, [handleSave])

  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded text-sm group bg-surface">
      <button
        className="cursor-grab opacity-50 hover:opacity-100 flex-shrink-0"
        onMouseDown={(e) => onDragStart(index, e)}
        aria-label="Drag to reorder"
      >
        ≡
      </button>

      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 bg-transparent border-b border-primary outline-none text-body"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
        />
      ) : (
        <span className="flex-1 truncate text-body">{content}</span>
      )}

      {!editing && (
        <>
          <button
            className="opacity-0 group-hover:opacity-70 hover:!opacity-100 flex-shrink-0"
            onClick={handleEditClick}
            aria-label="Edit queued message"
          >
            ✎
          </button>
          <button
            className="opacity-0 group-hover:opacity-70 hover:!opacity-100 flex-shrink-0"
            onClick={() => onDelete(id)}
            aria-label="Delete queued message"
          >
            ✕
          </button>
        </>
      )}
    </div>
  )
}
