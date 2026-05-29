import { create } from 'zustand'
import type { ThemeFile } from '../../shared/types'
import { createLogger } from '../../core/utils/logger'

const log = createLogger('settingsStore')

interface SettingsState {
  settings: Record<string, string>
  themes: ThemeFile[]
  activeTheme: string | null
  isLoading: boolean
  loadSettings: () => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
  loadThemes: () => Promise<void>
  applyTheme: (theme: ThemeFile) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  themes: [],
  activeTheme: null,
  isLoading: false,

  loadSettings: async () => {
    set({ isLoading: true })
    try {
      const settings = await window.agent.settings.get()
      const activeTheme = settings.activeTheme || null
      set({ settings, activeTheme, isLoading: false })
    } catch (err) {
      log.error('Failed to load settings', err)
      set({ isLoading: false })
    }
  },

  setSetting: async (key: string, value: string) => {
    try {
      await window.agent.settings.set(key, value)
      set((state) => ({
        settings: { ...state.settings, [key]: value },
        activeTheme: key === 'activeTheme' ? value : state.activeTheme,
      }))
    } catch (err) {
      log.error('Failed to set setting', err)
    }
  },

  loadThemes: async () => {
    try {
      const themes = await window.agent.themes.list()
      set({ themes })
    } catch (err) {
      log.error('Failed to load themes', err)
    }
  },

  applyTheme: (theme: ThemeFile) => {
    let styleEl = document.getElementById('agent-theme') as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'agent-theme'
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = theme.css
    get().setSetting('activeTheme', theme.filename)
    set({ activeTheme: theme.filename })
  },
}))
