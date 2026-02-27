import { useRef, type ReactNode } from 'react'
import { useClickOutside } from '../../hooks/useClickOutside'

interface SettingsPopoverShellProps {
  title: string
  onSave: () => void
  onClose: () => void
  children: ReactNode
}

export function SettingsPopoverShell({ title, onSave, onClose, children }: SettingsPopoverShellProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  useClickOutside(popoverRef, onClose)

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg shadow-xl text-sm flex flex-col w-[calc(100vw-3rem)] compact:w-full max-h-[80vh] compact:max-h-[80dvh]"
      style={{
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-text-muted)',
        color: 'var(--color-text)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-bg)' }}
      >
        <span className="font-medium">{title}</span>
        <button
          onClick={onClose}
          className="rounded hover:opacity-80 text-xs px-1.5 py-0.5 mobile:w-11 mobile:h-11 mobile:flex mobile:items-center mobile:justify-center mobile:text-sm"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Close settings"
        >
          x
        </button>
      </div>

      {/* Scrollable body */}
      <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto flex-1">
        {children}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-end gap-2 px-4 py-3 border-t flex-shrink-0"
        style={{ borderColor: 'var(--color-bg)' }}
      >
        <button
          onClick={onClose}
          className="rounded text-xs px-3 py-1 mobile:px-4 mobile:py-3 mobile:text-sm"
          style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          className="rounded text-xs bg-primary text-contrast px-3 py-1 mobile:px-4 mobile:py-3 mobile:text-sm"
        >
          Save
        </button>
      </div>
    </div>
  )
}
