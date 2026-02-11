import { useState } from 'react'
import { UserProfile } from './auth/UserProfile'

interface TitlebarProps {
  onOpenSettings: () => void
}

export function Titlebar({ onOpenSettings }: TitlebarProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  return (
    <div
      className="flex items-center h-10 select-none"
      style={{
        backgroundColor: 'var(--color-surface)',
        WebkitAppRegion: 'drag' as never,
      }}
    >
      {/* App title */}
      <div className="flex items-center gap-2u px-4u">
        <span className="text-[var(--color-primary)] font-bold text-base">
          Agent Desktop
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User profile */}
      <UserProfile />

      {/* Settings button */}
      <button
        onClick={onOpenSettings}
        className="px-3u py-1u hover:bg-[var(--color-bg)] rounded-sm transition-colors"
        style={{ WebkitAppRegion: 'no-drag' as never }}
        title="Settings (Ctrl+,)"
        aria-label="Open settings"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-text-muted)' }}>
          <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
          <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
        </svg>
      </button>

      {/* Window controls */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' as never }}
      >
        <button
          onClick={() => window.agent.window.minimize()}
          className="h-full px-3u hover:bg-[var(--color-bg)] transition-colors flex items-center"
          title="Minimize"
          aria-label="Minimize window"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ color: 'var(--color-text-muted)' }}>
            <rect y="5" width="12" height="1.5" rx="0.5" />
          </svg>
        </button>
        <button
          onClick={() => {
            window.agent.window.maximize()
            setIsMaximized((prev) => !prev)
          }}
          className="h-full px-3u hover:bg-[var(--color-bg)] transition-colors flex items-center"
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ color: 'var(--color-text-muted)' }}>
            {isMaximized ? (
              <>
                <rect x="2" y="0" width="9.5" height="9.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <rect x="0" y="2.5" width="9.5" height="9.5" rx="1" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.2" />
              </>
            ) : (
              <rect x="0.5" y="0.5" width="11" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            )}
          </svg>
        </button>
        <button
          onClick={() => window.agent.window.close()}
          className="h-full px-3u hover:bg-[var(--color-error)] transition-colors flex items-center"
          title="Close"
          aria-label="Close window"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ color: 'var(--color-text-muted)' }}>
            <path d="M1.05 1.05a.5.5 0 01.707 0L6 5.293l4.243-4.243a.5.5 0 11.707.707L6.707 6l4.243 4.243a.5.5 0 11-.707.707L6 6.707l-4.243 4.243a.5.5 0 01-.707-.707L5.293 6 1.05 1.757a.5.5 0 010-.707z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
