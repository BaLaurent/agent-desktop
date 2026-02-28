import { useEffect, type ReactNode } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { WelcomeScreen } from '../../pages/WelcomeScreen'

export function AuthGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore()
  const sdkBackend = useSettingsStore((s) => s.settings.ai_sdkBackend)

  // PI backend has its own auth — skip Claude login check
  const isPiBackend = sdkBackend === 'pi'

  useEffect(() => {
    if (!isPiBackend) checkAuth()
  }, [checkAuth, isPiBackend])

  if (!isPiBackend && isLoading) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
      </div>
    )
  }

  if (!isPiBackend && !isAuthenticated) {
    return <WelcomeScreen />
  }

  return <>{children}</>
}
