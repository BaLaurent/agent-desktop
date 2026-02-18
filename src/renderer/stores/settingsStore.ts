import { create } from 'zustand'
import type { ThemeFile } from '../../shared/types'

function syncStreamingTimeout(settings: Record<string, string>): void {
  const seconds = parseInt(settings.streamingTimeoutSeconds ?? '300', 10)
  const ms = isNaN(seconds) || seconds < 0 ? 300000 : seconds * 1000
  window.agent.settings.setStreamingTimeout(ms)
}

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
      syncStreamingTimeout(settings)
      set({ settings, activeTheme, isLoading: false })
    } catch (err) {
      console.error('[settings] Failed to load settings:', err)
      set({ isLoading: false })
    }
  },

  setSetting: async (key: string, value: string) => {
    try {
      await window.agent.settings.set(key, value)
      const newSettings = { ...get().settings, [key]: value }
      if (key === 'streamingTimeoutSeconds') {
        syncStreamingTimeout(newSettings)
      }
      set((state) => ({
        settings: { ...state.settings, [key]: value },
        activeTheme: key === 'activeTheme' ? value : state.activeTheme,
      }))
    } catch (err) {
      console.error('[settings] Failed to set setting:', err)
    }
  },

  loadThemes: async () => {
    try {
      const themes = await window.agent.themes.list()
      set({ themes })
    } catch (err) {
      console.error('[settings] Failed to load themes:', err)
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
