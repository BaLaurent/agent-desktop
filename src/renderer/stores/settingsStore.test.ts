import { vi } from 'vitest'
import { mockAgent } from '../__tests__/setup'
import { useSettingsStore } from './settingsStore'

beforeEach(() => {
  useSettingsStore.setState({
    settings: {},
    themes: [],
    activeTheme: null,
    isLoading: false,
  })
})

describe('settingsStore', () => {
  describe('syncStreamingTimeout', () => {
    it('calls setStreamingTimeout with default 300s on loadSettings', async () => {
      mockAgent.settings.get.mockResolvedValueOnce({})
      await useSettingsStore.getState().loadSettings()
      expect(mockAgent.settings.setStreamingTimeout).toHaveBeenCalledWith(300000)
    })

    it('converts streamingTimeoutSeconds to ms on loadSettings', async () => {
      mockAgent.settings.get.mockResolvedValueOnce({ streamingTimeoutSeconds: '60' })
      await useSettingsStore.getState().loadSettings()
      expect(mockAgent.settings.setStreamingTimeout).toHaveBeenCalledWith(60000)
    })

    it('treats 0 as no timeout (0ms)', async () => {
      mockAgent.settings.get.mockResolvedValueOnce({ streamingTimeoutSeconds: '0' })
      await useSettingsStore.getState().loadSettings()
      expect(mockAgent.settings.setStreamingTimeout).toHaveBeenCalledWith(0)
    })

    it('falls back to 300s for invalid value', async () => {
      mockAgent.settings.get.mockResolvedValueOnce({ streamingTimeoutSeconds: 'abc' })
      await useSettingsStore.getState().loadSettings()
      expect(mockAgent.settings.setStreamingTimeout).toHaveBeenCalledWith(300000)
    })

    it('syncs timeout when streamingTimeoutSeconds is set via setSetting', async () => {
      await useSettingsStore.getState().setSetting('streamingTimeoutSeconds', '120')
      expect(mockAgent.settings.setStreamingTimeout).toHaveBeenCalledWith(120000)
    })

    it('does not sync timeout when unrelated setting is changed', async () => {
      mockAgent.settings.setStreamingTimeout.mockClear()
      await useSettingsStore.getState().setSetting('theme', 'light')
      expect(mockAgent.settings.setStreamingTimeout).not.toHaveBeenCalled()
    })
  })

  it('loadSettings populates settings and activeTheme', async () => {
    mockAgent.settings.get.mockResolvedValueOnce({ theme: 'dark', activeTheme: 'monokai' })
    await useSettingsStore.getState().loadSettings()
    const state = useSettingsStore.getState()
    expect(state.settings.theme).toBe('dark')
    expect(state.activeTheme).toBe('monokai')
    expect(state.isLoading).toBe(false)
  })

  it('setSetting updates local state and calls IPC', async () => {
    await useSettingsStore.getState().setSetting('theme', 'light')
    expect(mockAgent.settings.set).toHaveBeenCalledWith('theme', 'light')
    expect(useSettingsStore.getState().settings.theme).toBe('light')
  })

  it('setSetting updates activeTheme when key is activeTheme', async () => {
    await useSettingsStore.getState().setSetting('activeTheme', 'monokai')
    expect(useSettingsStore.getState().activeTheme).toBe('monokai')
  })
})
