import { create } from 'zustand'
import type { Conversation, Folder } from '../../shared/types'

interface ConversationsState {
  conversations: Conversation[]
  folders: Folder[]
  activeConversationId: number | null
  searchQuery: string
  isLoading: boolean

  loadConversations: () => Promise<void>
  loadFolders: () => Promise<void>
  createConversation: (title?: string) => Promise<Conversation>
  updateConversation: (id: number, data: Partial<Conversation>) => Promise<void>
  deleteConversation: (id: number) => Promise<void>
  setActiveConversation: (id: number | null) => void
  searchConversations: (query: string) => Promise<void>

  createFolder: (name: string, parentId?: number) => Promise<void>
  updateFolder: (id: number, data: Partial<Folder>) => Promise<void>
  deleteFolder: (id: number, mode?: 'keep' | 'delete') => Promise<void>
  reorderFolders: (ids: number[]) => Promise<void>

  moveToFolder: (conversationId: number, folderId: number | null) => Promise<void>
  exportConversation: (id: number, format: 'markdown' | 'json') => Promise<string>
  importConversation: (data: string) => Promise<void>
}

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  conversations: [],
  folders: [],
  activeConversationId: null,
  searchQuery: '',
  isLoading: false,

  loadConversations: async () => {
    set({ isLoading: true })
    const conversations = await window.agent.conversations.list()
    set({ conversations, isLoading: false })
  },

  loadFolders: async () => {
    const folders = await window.agent.folders.list()
    set({ folders })
  },

  createConversation: async (title?: string) => {
    const conversation = await window.agent.conversations.create(title)
    set((s) => ({ conversations: [conversation, ...s.conversations] }))
    set({ activeConversationId: conversation.id })
    return conversation
  },

  updateConversation: async (id, data) => {
    await window.agent.conversations.update(id, data)
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, ...data, updated_at: new Date().toISOString() } : c
      ),
    }))
  },

  deleteConversation: async (id) => {
    await window.agent.conversations.delete(id)
    const { activeConversationId, conversations } = get()
    const remaining = conversations.filter((c) => c.id !== id)
    set({
      conversations: remaining,
      activeConversationId: activeConversationId === id ? null : activeConversationId,
    })
  },

  setActiveConversation: (id) => {
    set({ activeConversationId: id })
  },

  searchConversations: async (query) => {
    set({ searchQuery: query })
    if (!query.trim()) {
      await get().loadConversations()
      return
    }
    set({ isLoading: true })
    const conversations = await window.agent.conversations.search(query)
    set({ conversations, isLoading: false })
  },

  createFolder: async (name, parentId?) => {
    await window.agent.folders.create(name, parentId)
    await get().loadFolders()
  },

  updateFolder: async (id, data) => {
    await window.agent.folders.update(id, data)
    await get().loadFolders()
  },

  deleteFolder: async (id, mode) => {
    const prevFolders = get().folders
    const prevConversations = get().conversations
    const { activeConversationId } = get()

    if (mode === 'delete') {
      // Collect all descendant folder IDs
      const allFolderIds = new Set<number>([id])
      const queue = [id]
      while (queue.length > 0) {
        const current = queue.shift()!
        for (const f of prevFolders) {
          if (f.parent_id === current && !allFolderIds.has(f.id)) {
            allFolderIds.add(f.id)
            queue.push(f.id)
          }
        }
      }
      const deletedConvIds = new Set(
        prevConversations.filter((c) => c.folder_id !== null && allFolderIds.has(c.folder_id)).map((c) => c.id)
      )
      // Optimistic: remove folders + conversations
      set((s) => ({
        folders: s.folders.filter((f) => !allFolderIds.has(f.id)),
        conversations: s.conversations.filter((c) => !deletedConvIds.has(c.id)),
        activeConversationId: activeConversationId !== null && deletedConvIds.has(activeConversationId)
          ? null
          : activeConversationId,
      }))
      try {
        await window.agent.folders.delete(id, 'delete')
      } catch {
        set({ folders: prevFolders, conversations: prevConversations, activeConversationId })
      }
    } else {
      // Default: reparent
      set((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
        conversations: s.conversations.map((c) =>
          c.folder_id === id ? { ...c, folder_id: null } : c
        ),
      }))
      try {
        await window.agent.folders.delete(id)
      } catch {
        set({ folders: prevFolders, conversations: prevConversations })
      }
    }
  },

  reorderFolders: async (ids) => {
    await window.agent.folders.reorder(ids)
    await get().loadFolders()
  },

  moveToFolder: async (conversationId, folderId) => {
    // Optimistic update
    const prev = get().conversations
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, folder_id: folderId } : c
      ),
    }))
    try {
      await window.agent.conversations.update(conversationId, { folder_id: folderId } as Partial<Conversation>)
    } catch {
      set({ conversations: prev }) // rollback
    }
  },

  exportConversation: async (id, format) => {
    return await window.agent.conversations.export(id, format)
  },

  importConversation: async (data) => {
    await window.agent.conversations.import(data)
    await get().loadConversations()
  },
}))

// Listen for auto-title updates from main process
if (typeof window !== 'undefined' && window.agent?.events?.onConversationTitleUpdated) {
  window.agent.events.onConversationTitleUpdated(({ id, title }) => {
    useConversationsStore.setState((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title } : c
      ),
    }))
  })
}

// Listen for conversation list refresh (e.g. Quick Chat conversation created externally)
if (typeof window !== 'undefined' && window.agent?.events?.onConversationsRefresh) {
  window.agent.events.onConversationsRefresh(() => {
    useConversationsStore.getState().loadConversations()
  })
}
