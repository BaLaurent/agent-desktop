import { useState, useCallback, useRef, useEffect } from 'react'

interface QueueItemProps {
  id: string
  content: string
  index: number
  onEdit: (id: string, newContent: string) => void
  onDelete: (id: string) => void
  onDragStart: (index: number, e: React.MouseEvent) => void
  onEditStart?: () => void
  onEditEnd?: () => void
}

export function QueueItem({ id, content, index, onEdit, onDelete, onDragStart, onEditStart, onEditEnd }: QueueItemProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(content)
  const inputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  const editActiveRef = useRef(false)
  const onEditEndRef = useRef(onEditEnd)
  onEditEndRef.current = onEditEnd

  // Unlock queue if component unmounts while editing
  useEffect(() => () => {
    if (editActiveRef.current) onEditEndRef.current?.()
  }, [])

  const handleEditClick = useCallback(() => {
    setEditValue(content)
    setEditing(true)
    editActiveRef.current = true
    savingRef.current = false
    onEditStart?.()
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [content, onEditStart])

  const handleSave = useCallback(() => {
    if (savingRef.current) return
    savingRef.current = true
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== content) {
      onEdit(id, trimmed)
    }
    setEditing(false)
    editActiveRef.current = false
    onEditEnd?.()
  }, [editValue, content, id, onEdit, onEditEnd])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setEditing(false)
      editActiveRef.current = false
      onEditEnd?.()
    }
  }, [handleSave, onEditEnd])

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
        <span className="flex-1 truncate text-body cursor-text" onClick={handleEditClick}>{content}</span>
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
