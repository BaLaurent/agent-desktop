const settingsMock: Record<string, string> = {}
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: Record<string, string> }) => unknown) =>
    selector({ settings: settingsMock }),
}))

import { renderHook } from '@testing-library/react'
import { useAgentDisplayName } from './useAgentDisplayName'

describe('useAgentDisplayName', () => {
  afterEach(() => {
    delete settingsMock['agent_name']
    delete settingsMock['ai_sdkBackend']
  })

  it('returns "Claude" by default (no agent_name, default backend)', () => {
    const { result } = renderHook(() => useAgentDisplayName())
    expect(result.current).toBe('Claude')
  })

  it('returns agent_name when set', () => {
    settingsMock['agent_name'] = 'Jarvis'
    const { result } = renderHook(() => useAgentDisplayName())
    expect(result.current).toBe('Jarvis')
  })

  it('returns backend display name when no agent_name', () => {
    settingsMock['ai_sdkBackend'] = 'pi'
    const { result } = renderHook(() => useAgentDisplayName())
    expect(result.current).toBe('PI')
  })

  it('prefers agent_name over backend display name', () => {
    settingsMock['agent_name'] = 'HAL 9000'
    settingsMock['ai_sdkBackend'] = 'pi'
    const { result } = renderHook(() => useAgentDisplayName())
    expect(result.current).toBe('HAL 9000')
  })

  it('falls back to "Claude" for unknown backend', () => {
    settingsMock['ai_sdkBackend'] = 'unknown-backend'
    const { result } = renderHook(() => useAgentDisplayName())
    expect(result.current).toBe('Claude')
  })
})
