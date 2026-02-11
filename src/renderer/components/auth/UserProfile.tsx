import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'

export function UserProfile() {
  const { user, logout } = useAuthStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!user) return null

  const initials = (user.name || user.email || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div ref={ref} className="relative" style={{ WebkitAppRegion: 'no-drag' as never }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1 rounded-md transition-colors hover:opacity-80"
        title={user.email}
      >
        {/* Avatar */}
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold relative"
          style={{
            backgroundColor: 'var(--color-deep)',
            color: 'var(--color-primary)',
          }}
        >
          {initials}
          {/* Green dot */}
          <div
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border"
            style={{
              backgroundColor: 'var(--color-success)',
              borderColor: 'var(--color-surface)',
            }}
          />
        </div>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-md shadow-lg py-1 min-w-[180px] z-50"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-bg)',
          }}
        >
          <div
            className="px-3 py-2 text-xs border-b"
            style={{
              color: 'var(--color-text-muted)',
              borderColor: 'var(--color-bg)',
            }}
          >
            <div style={{ color: 'var(--color-text)' }}>{user.name}</div>
            <div>{user.email}</div>
          </div>
          <button
            onClick={() => {
              setOpen(false)
              logout()
            }}
            className="w-full text-left px-3 py-2 text-sm transition-colors hover:opacity-80"
            style={{ color: 'var(--color-error)' }}
          >
            Logout
          </button>
        </div>
      )}
    </div>
  )
}
