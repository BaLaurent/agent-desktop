import { create } from 'zustand'
import type { McpServer, McpServerConfig, McpTestResult } from '../../shared/types'

interface McpState {
  servers: McpServer[]
  isLoading: boolean
  testResults: Record<number, { loading: boolean; result?: McpTestResult }>
  loadServers: () => Promise<void>
  addServer: (config: McpServerConfig) => Promise<void>
  updateServer: (id: number, config: Partial<McpServerConfig>) => Promise<void>
  removeServer: (id: number) => Promise<void>
  toggleServer: (id: number) => Promise<void>
  testConnection: (id: number) => Promise<void>
  clearTestResult: (id: number) => void
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  isLoading: false,
  testResults: {},

  loadServers: async () => {
    set({ isLoading: true })
    try {
      const servers = await window.agent.mcp.listServers()
      set({ servers, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  addServer: async (config: McpServerConfig) => {
    try {
      await window.agent.mcp.addServer(config)
      await get().loadServers()
    } catch {
      // let caller handle
    }
  },

  updateServer: async (id: number, config: Partial<McpServerConfig>) => {
    try {
      await window.agent.mcp.updateServer(id, config)
      await get().loadServers()
    } catch {
      // let caller handle
    }
  },

  removeServer: async (id: number) => {
    try {
      await window.agent.mcp.removeServer(id)
      await get().loadServers()
    } catch {
      // let caller handle
    }
  },

  toggleServer: async (id: number) => {
    try {
      await window.agent.mcp.toggleServer(id)
      await get().loadServers()
    } catch {
      // let caller handle
    }
  },

  testConnection: async (id: number) => {
    set((state) => ({
      testResults: { ...state.testResults, [id]: { loading: true } },
    }))
    try {
      const result = await window.agent.mcp.testConnection(id)
      set((state) => ({
        testResults: { ...state.testResults, [id]: { loading: false, result } },
      }))
    } catch (err) {
      set((state) => ({
        testResults: {
          ...state.testResults,
          [id]: { loading: false, result: { success: false, output: (err as Error).message } },
        },
      }))
    }
  },

  clearTestResult: (id: number) => {
    set((state) => {
      const next = { ...state.testResults }
      delete next[id]
      return { testResults: next }
    })
  },
}))
