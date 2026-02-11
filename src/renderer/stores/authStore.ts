import { create } from 'zustand'
import type { AuthDiagnostics } from '../../shared/types'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  user: { email: string; name: string } | null
  error: string | null
  diagnostics: AuthDiagnostics | null
  checkAuth: () => Promise<void>
  login: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  error: null,
  diagnostics: null,

  checkAuth: async () => {
    set({ isLoading: true, error: null })
    try {
      const status = await window.agent.auth.getStatus()
      set({
        isAuthenticated: status.authenticated,
        user: status.user,
        error: status.error || null,
        diagnostics: status.diagnostics || null,
        isLoading: false,
      })
    } catch {
      set({ isAuthenticated: false, user: null, isLoading: false })
    }
  },

  login: async () => {
    set({ isLoading: true, error: null })
    try {
      const status = await window.agent.auth.login()
      set({
        isAuthenticated: status.authenticated,
        user: status.user,
        diagnostics: status.diagnostics || null,
        isLoading: false,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      set({ error: msg, isLoading: false })
      // Fetch diagnostics on failure
      try {
        const status = await window.agent.auth.getStatus()
        set({ diagnostics: status.diagnostics || null })
      } catch {
        // diagnostics fetch failed, leave as-is
      }
    }
  },

  logout: async () => {
    try {
      await window.agent.auth.logout()
    } finally {
      set({ isAuthenticated: false, user: null, error: null, diagnostics: null })
    }
  },
}))
