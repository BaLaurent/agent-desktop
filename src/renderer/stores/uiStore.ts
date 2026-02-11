import { create } from 'zustand'

interface UiState {
  sidebarVisible: boolean
  panelVisible: boolean
  activeView: 'chat' | 'settings' | 'welcome'
  toggleSidebar: () => void
  togglePanel: () => void
  setActiveView: (view: UiState['activeView']) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarVisible: true,
  panelVisible: false,
  activeView: 'welcome',
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible })),
  setActiveView: (activeView) => set({ activeView }),
}))
