import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Function('return import(...)') pattern used by piSdk.ts (and anthropic.ts)
// bypasses Vitest's module resolution, so we can't mock the actual import.
// Instead, we test the caching logic by mocking the Function constructor.
const mockPISdk = {
  createAgentSession: vi.fn(),
  SessionManager: { inMemory: vi.fn() },
  codingTools: [],
}

describe('loadPISdk', () => {
  beforeEach(() => {
    vi.resetModules()
    // Mock globalThis.Function to intercept the dynamic import trick
    vi.stubGlobal(
      'Function',
      vi.fn(() => () => Promise.resolve(mockPISdk))
    )
  })

  it('returns the PI SDK module', async () => {
    const { loadPISdk } = await import('./piSdk')
    const sdk = await loadPISdk()
    expect(sdk).toBe(mockPISdk)
    expect(sdk.createAgentSession).toBeDefined()
    expect(sdk.SessionManager).toBeDefined()
  })

  it('caches the SDK after first load', async () => {
    const { loadPISdk } = await import('./piSdk')
    const first = await loadPISdk()
    const second = await loadPISdk()
    expect(first).toBe(second)
    // Function constructor should only be called once (for the first import)
    expect(globalThis.Function).toHaveBeenCalledTimes(1)
  })
})
