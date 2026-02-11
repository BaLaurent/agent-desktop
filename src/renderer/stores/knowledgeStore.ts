import { create } from 'zustand'
import type { KnowledgeCollection } from '../../shared/types'

interface KnowledgeState {
  collections: KnowledgeCollection[]
  loading: boolean
  error: string | null
  loadCollections: () => Promise<void>
}

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  collections: [],
  loading: false,
  error: null,
  loadCollections: async () => {
    set({ loading: true, error: null })
    try {
      const collections = await window.agent.kb.listCollections()
      set({ collections, loading: false })
    } catch (err) {
      console.error('[knowledgeStore] loadCollections failed:', err)
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load collections' })
    }
  },
}))
