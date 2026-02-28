import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { PiUINotification } from '../../../shared/piUITypes'

interface ExtensionToastProps {
  notifications: PiUINotification[]
  onDismiss: (id: string) => void
}

const containerStyle: CSSProperties = {
  position: 'fixed',
  top: 12,
  right: 12,
  zIndex: 9998,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  pointerEvents: 'none',
}

const cardBaseStyle: CSSProperties = {
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 13,
  maxWidth: 320,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  pointerEvents: 'auto',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
}

const closeButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--color-text-muted)',
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
  flexShrink: 0,
}

const levelColors: Record<PiUINotification['level'], string> = {
  info: 'var(--color-primary)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
}

function ToastCard({ notification, onDismiss }: { notification: PiUINotification; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), 5000)
    return () => clearTimeout(timer)
  }, [notification.id, onDismiss])

  return (
    <div
      style={{
        ...cardBaseStyle,
        borderLeft: `4px solid ${levelColors[notification.level]}`,
      }}
      role="alert"
      data-testid={`toast-${notification.id}`}
    >
      <span style={{ flex: 1 }}>{notification.message}</span>
      <button
        style={closeButtonStyle}
        onClick={() => onDismiss(notification.id)}
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  )
}

export function ExtensionToast({ notifications, onDismiss }: ExtensionToastProps) {
  return (
    <div style={containerStyle} data-testid="extension-toast-container">
      {notifications.map((n) => (
        <ToastCard key={n.id} notification={n} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
