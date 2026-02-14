import { create } from 'zustand'
import type { KeyboardShortcut } from '../../shared/types'

const GLOBAL_SHORTCUT_ACTIONS = new Set(['quick_chat', 'quick_voice'])

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

      // Re-register OS-level global shortcuts when a global action is changed
      const shortcut = get().shortcuts.find((s) => s.id === id)
      if (shortcut && GLOBAL_SHORTCUT_ACTIONS.has(shortcut.action)) {
        await window.agent.quickChat.reregisterShortcuts()
      }
    } catch {
      // let caller handle
    }
  },
}))
