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
