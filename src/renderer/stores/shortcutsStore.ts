import { create } from 'zustand'
import type { KeyboardShortcut } from '../../shared/types'

interface ShortcutsState {
  shortcuts: KeyboardShortcut[]
  isLoading: boolean
  loadShortcuts: () => Promise<void>
  updateShortcut: (id: number, keybinding: string) => Promise<void>
}

export const useShortcutsStore = create<ShortcutsState>((set, get) => ({
  shortcuts: [],
  isLoading: false,

  loadShortcuts: async () => {
    set({ isLoading: true })
    try {
      const shortcuts = await window.agent.shortcuts.list()
      set({ shortcuts, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  updateShortcut: async (id: number, keybinding: string) => {
    try {
      await window.agent.shortcuts.update(id, keybinding)
      await get().loadShortcuts()
    } catch {
      // let caller handle
    }
  },
}))
