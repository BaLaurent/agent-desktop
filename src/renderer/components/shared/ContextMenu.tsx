import { useState, useRef, useCallback, type ReactNode, type CSSProperties } from 'react'
import { useClickOutside } from '../../hooks/useClickOutside'

interface ContextMenuProps {
  position: { x: number; y: number }
  onClose: () => void
  draggable?: boolean
  className?: string
  style?: CSSProperties
  role?: string
  'aria-label'?: string
  children: ReactNode
}

interface ContextMenuItemProps {
  onClick: () => void
  danger?: boolean
  className?: string
  role?: string
  'aria-label'?: string
  children: ReactNode
}

export function ContextMenu({
  position,
  onClose,
  draggable = true,
  className,
  style,
  role = 'menu',
  'aria-label': ariaLabel,
  children,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(position)
  const dragRef = useRef({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 })

  useClickOutside(ref, onClose)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.active) return
      setPos({
        x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
        y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
      })
    }
    const onUp = () => {
      dragRef.current.active = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [pos.x, pos.y])

  return (
    <div
      ref={ref}
      className={`fixed z-50 rounded shadow-lg py-1 text-sm ${className ?? ''}`}
      style={{
        left: pos.x,
        top: pos.y,
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-bg)',
        color: 'var(--color-text)',
        ...style,
      }}
      role={role}
      aria-label={ariaLabel}
    >
      {draggable && (
        <div
          className="cursor-grab active:cursor-grabbing px-3 py-1 select-none"
          onMouseDown={handleDragStart}
          data-testid="drag-handle"
        >
          <div className="w-8 h-0.5 mx-auto rounded-full" style={{ backgroundColor: 'var(--color-text-muted)', opacity: 0.4 }} />
        </div>
      )}
      {children}
    </div>
  )
}

export function ContextMenuItem({
  onClick,
  danger,
  className,
  role = 'menuitem',
  'aria-label': ariaLabel,
  children,
}: ContextMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 mobile:py-2.5 hover:bg-[var(--color-bg)] ${className ?? ''}`}
      style={{
        backgroundColor: 'transparent',
        ...(danger ? { color: 'var(--color-error)' } : {}),
      }}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  )
}

export function ContextMenuDivider() {
  return <div className="border-t my-1" style={{ borderColor: 'var(--color-bg)' }} />
}
