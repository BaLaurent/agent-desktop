import { useAuthStore } from './authStore'
import { mockAgent } from '../__tests__/setup'
import { act } from '@testing-library/react'

describe('authStore', () => {
  beforeEach(() => {
    act(() => {
      useAuthStore.setState({
        isAuthenticated: false,
        isLoading: true,
        user: null,
        error: null,
        diagnostics: null,
      })
    })
  })

  it('has initial state with isLoading true', () => {
    const state = useAuthStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.isLoading).toBe(true)
    expect(state.user).toBeNull()
    expect(state.error).toBeNull()
    expect(state.diagnostics).toBeNull()
  })

  describe('checkAuth', () => {
    it('sets authenticated and user on success', async () => {
      mockAgent.auth.getStatus.mockResolvedValueOnce({
        authenticated: true,
        user: { email: 'user@example.com', name: 'User' },
      })

      await act(async () => {
        await useAuthStore.getState().checkAuth()
      })

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(true)
      expect(state.user).toEqual({ email: 'user@example.com', name: 'User' })
      expect(state.isLoading).toBe(false)
    })

    it('resets to unauthenticated on failure', async () => {
      mockAgent.auth.getStatus.mockRejectedValueOnce(new Error('Network error'))

      await act(async () => {
        await useAuthStore.getState().checkAuth()
      })

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.user).toBeNull()
      expect(state.isLoading).toBe(false)
    })

    it('sets isLoading during fetch', async () => {
      let resolve: (v: unknown) => void
      const pending = new Promise((r) => { resolve = r })
      mockAgent.auth.getStatus.mockReturnValueOnce(pending)

      const promise = act(async () => {
        const p = useAuthStore.getState().checkAuth()
        expect(useAuthStore.getState().isLoading).toBe(true)
        resolve!({ authenticated: false, user: null })
        await p
      })

      await promise
      expect(useAuthStore.getState().isLoading).toBe(false)
    })

    it('sets error from status response', async () => {
      mockAgent.auth.getStatus.mockResolvedValueOnce({
        authenticated: false,
        user: null,
        error: 'Token expired',
      })

      await act(async () => {
        await useAuthStore.getState().checkAuth()
      })

      expect(useAuthStore.getState().error).toBe('Token expired')
    })

    it('sets diagnostics from status response', async () => {
      const diag = { claudePath: '/usr/bin/claude', nodeVersion: 'v20' }
      mockAgent.auth.getStatus.mockResolvedValueOnce({
        authenticated: true,
        user: { email: 'a@b.com', name: 'A' },
        diagnostics: diag,
      })

      await act(async () => {
        await useAuthStore.getState().checkAuth()
      })

      expect(useAuthStore.getState().diagnostics).toEqual(diag)
    })
  })

  describe('login', () => {
    it('sets authenticated and user on success', async () => {
      mockAgent.auth.login.mockResolvedValueOnce({
        authenticated: true,
        user: { email: 'login@test.com', name: 'Login' },
      })

      await act(async () => {
        await useAuthStore.getState().login()
      })

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(true)
      expect(state.user).toEqual({ email: 'login@test.com', name: 'Login' })
      expect(state.isLoading).toBe(false)
      expect(state.error).toBeNull()
    })

    it('sets error message on failure', async () => {
      mockAgent.auth.login.mockRejectedValueOnce(new Error('Auth failed'))
      mockAgent.auth.getStatus.mockResolvedValueOnce({ authenticated: false, user: null })

      await act(async () => {
        await useAuthStore.getState().login()
      })

      const state = useAuthStore.getState()
      expect(state.error).toBe('Auth failed')
      expect(state.isLoading).toBe(false)
    })

    it('fetches diagnostics on failure', async () => {
      const diag = { claudePath: '/usr/bin/claude', nodeVersion: 'v20' }
      mockAgent.auth.login.mockRejectedValueOnce(new Error('Fail'))
      mockAgent.auth.getStatus.mockResolvedValueOnce({
        authenticated: false,
        user: null,
        diagnostics: diag,
      })

      await act(async () => {
        await useAuthStore.getState().login()
      })

      expect(mockAgent.auth.getStatus).toHaveBeenCalled()
      expect(useAuthStore.getState().diagnostics).toEqual(diag)
    })

    it('sets "Login failed" for non-Error throws', async () => {
      mockAgent.auth.login.mockRejectedValueOnce('string error')
      mockAgent.auth.getStatus.mockResolvedValueOnce({ authenticated: false, user: null })

      await act(async () => {
        await useAuthStore.getState().login()
      })

      expect(useAuthStore.getState().error).toBe('Login failed')
    })

    it('silently handles diagnostics fetch failure', async () => {
      mockAgent.auth.login.mockRejectedValueOnce(new Error('Fail'))
      mockAgent.auth.getStatus.mockRejectedValueOnce(new Error('Diag failed'))

      await act(async () => {
        await useAuthStore.getState().login()
      })

      const state = useAuthStore.getState()
      expect(state.error).toBe('Fail')
      // No additional error set from diagnostics failure
      expect(state.diagnostics).toBeNull()
    })
  })

  describe('logout', () => {
    it('calls auth.logout and resets state', async () => {
      act(() => {
        useAuthStore.setState({
          isAuthenticated: true,
          user: { email: 'a@b.com', name: 'A' },
          error: 'old error',
          diagnostics: { claudePath: '/usr/bin/claude' } as any,
        })
      })

      await act(async () => {
        await useAuthStore.getState().logout()
      })

      expect(mockAgent.auth.logout).toHaveBeenCalled()
      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.user).toBeNull()
      expect(state.error).toBeNull()
      expect(state.diagnostics).toBeNull()
    })

    it('resets state even if logout throws', async () => {
      mockAgent.auth.logout.mockRejectedValueOnce(new Error('Logout failed'))
      act(() => {
        useAuthStore.setState({ isAuthenticated: true, user: { email: 'a@b.com', name: 'A' } })
      })

      await act(async () => {
        await useAuthStore.getState().logout().catch(() => {})
      })

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.user).toBeNull()
    })
  })
})
