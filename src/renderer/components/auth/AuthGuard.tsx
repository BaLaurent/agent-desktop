import { useEffect, type ReactNode } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { WelcomeScreen } from '../../pages/WelcomeScreen'

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore()

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (isLoading) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <WelcomeScreen />
  }

  return <>{children}</>
}
