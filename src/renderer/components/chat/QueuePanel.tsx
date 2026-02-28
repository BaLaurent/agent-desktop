import { useCallback, useRef } from 'react'
import { QueueItem } from './QueueItem'
import type { QueuedMessage } from '../../stores/chatStore'

interface QueuePanelProps {
  messages: QueuedMessage[]
  paused: boolean
  onEdit: (messageId: string, newContent: string) => void
  onDelete: (messageId: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onClear: () => void
  onResume: () => void
  onEditStart?: () => void
  onEditEnd?: () => void
}

export function QueuePanel({ messages, paused, onEdit, onDelete, onReorder, onClear, onResume, onEditStart, onEditEnd }: QueuePanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const dropIndexRef = useRef<number | null>(null)

  const handleDragStart = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault()
    dropIndexRef.current = index

    const startY = e.clientY
    const items = listRef.current?.children
    if (!items || items.length === 0) return

    const itemHeight = (items[0] as HTMLElement).offsetHeight

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY
      const offset = Math.round(delta / itemHeight)
      dropIndexRef.current = Math.max(0, Math.min(messages.length - 1, index + offset))
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const target = dropIndexRef.current ?? index
      if (target !== index) {
        onReorder(index, target)
      }
      dropIndexRef.current = null
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [messages.length, onReorder])

  if (messages.length === 0) return null

  return (
    <div className="flex-shrink-0 px-4 py-2 border-t border-surface text-body">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted">
          Queue ({messages.length}){paused ? ' — Paused' : ''}
        </span>
        <div className="flex gap-1">
          {paused && (
            <button
              className="text-xs px-2 py-0.5 rounded bg-primary hover:opacity-80"
              style={{ color: 'var(--color-bg)' }}
              onClick={onResume}
            >
              ▶ Resume
            </button>
          )}
          <button
            className="text-xs px-2 py-0.5 rounded opacity-60 hover:opacity-100"
            onClick={onClear}
            aria-label="Clear queue"
          >
            ✕ Clear
          </button>
        </div>
      </div>
      <div ref={listRef} className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
        {messages.map((msg, i) => (
          <QueueItem
            key={msg.id}
            id={msg.id}
            content={msg.content}
            index={i}
            onEdit={onEdit}
            onDelete={onDelete}
            onDragStart={handleDragStart}
            onEditStart={onEditStart}
            onEditEnd={onEditEnd}
          />
        ))}
      </div>
    </div>
  )
}
