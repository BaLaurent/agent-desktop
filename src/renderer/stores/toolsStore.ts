import { create } from 'zustand'
import type { AllowedTool } from '../../shared/types'

interface ToolsState {
  tools: AllowedTool[]
  isLoading: boolean
  allEnabled: boolean
  loadTools: () => Promise<void>
  toggleTool: (toolName: string) => Promise<void>
  enableAll: () => Promise<void>
  disableAll: () => Promise<void>
}

export const useToolsStore = create<ToolsState>((set, get) => ({
  tools: [],
  isLoading: false,
  allEnabled: true,

  loadTools: async () => {
    set({ isLoading: true })
    try {
      const tools = await window.agent.tools.listAvailable()
      set({ tools, isLoading: false, allEnabled: tools.every((t) => t.enabled) })
    } catch {
      set({ isLoading: false })
    }
  },

  toggleTool: async (toolName: string) => {
    try {
      await window.agent.tools.toggle(toolName)
      await get().loadTools()
    } catch {
      // let caller handle
    }
  },

  enableAll: async () => {
    try {
      await window.agent.tools.setEnabled('preset:claude_code')
      await get().loadTools()
    } catch {
      // let caller handle
    }
  },

  disableAll: async () => {
    try {
      await window.agent.tools.setEnabled('[]')
      await get().loadTools()
    } catch {
      // let caller handle
    }
  },
}))
