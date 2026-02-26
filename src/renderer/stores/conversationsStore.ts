import { create } from 'zustand'
import type { Conversation, Folder } from '../../shared/types'

interface ConversationsState {
  conversations: Conversation[]
  folders: Folder[]
  activeConversationId: number | null
  searchQuery: string
  isLoading: boolean

  // Selection
  selectedIds: Set<number>
  lastClickedId: number | null
  handleSelect: (id: number, ctrlKey: boolean, shiftKey: boolean, visibleOrder: number[]) => void
  clearSelection: () => void
  deleteSelected: () => Promise<void>
  moveSelectedToFolder: (folderId: number | null) => Promise<void>

  loadConversations: () => Promise<void>
  loadFolders: () => Promise<void>
  createConversation: (title?: string, folderId?: number) => Promise<Conversation>
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
  forkConversation: (conversationId: number, messageId: number) => Promise<Conversation>
}

const WEB_MODE = typeof window !== 'undefined' && !!(window as any).__AGENT_WEB_MODE__
const SESSION_KEY = 'agent_activeConversationId'

function readSavedConversationId(): number | null {
  if (!WEB_MODE) return null
  const saved = sessionStorage.getItem(SESSION_KEY)
  return saved ? Number(saved) : null
}

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  conversations: [],
  folders: [],
  activeConversationId: readSavedConversationId(),
  searchQuery: '',
  isLoading: false,

  // Selection
  selectedIds: new Set(),
  lastClickedId: null,

  handleSelect: (id, ctrlKey, shiftKey, visibleOrder) => {
    const { selectedIds, lastClickedId } = get()

    if (ctrlKey) {
      // Toggle individual item
      const next = new Set(selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      set({ selectedIds: next, lastClickedId: id })
    } else if (shiftKey && lastClickedId !== null) {
      // Range selection
      const anchorIdx = visibleOrder.indexOf(lastClickedId)
      const targetIdx = visibleOrder.indexOf(id)
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const start = Math.min(anchorIdx, targetIdx)
        const end = Math.max(anchorIdx, targetIdx)
        const next = new Set(selectedIds)
        for (let i = start; i <= end; i++) next.add(visibleOrder[i])
        set({ selectedIds: next })
      }
    } else {
      // Normal click — clear selection, activate
      set({ selectedIds: new Set(), lastClickedId: id })
      get().setActiveConversation(id)
    }
  },

  clearSelection: () => {
    set({ selectedIds: new Set(), lastClickedId: null })
  },

  deleteSelected: async () => {
    const { selectedIds, conversations, activeConversationId } = get()
    const ids = [...selectedIds]
    if (ids.length === 0) return

    // Optimistic update
    const remaining = conversations.filter((c) => !selectedIds.has(c.id))
    set({
      conversations: remaining,
      selectedIds: new Set(),
      lastClickedId: null,
      activeConversationId: activeConversationId !== null && selectedIds.has(activeConversationId)
        ? null
        : activeConversationId,
    })

    try {
      await window.agent.conversations.deleteMany(ids)
    } catch {
      // Rollback
      set({ conversations, activeConversationId })
    }
  },

  moveSelectedToFolder: async (folderId) => {
    const { selectedIds, conversations } = get()
    const ids = [...selectedIds]
    if (ids.length === 0) return

    // Optimistic update
    const prev = conversations
    set({
      conversations: conversations.map((c) =>
        selectedIds.has(c.id) ? { ...c, folder_id: folderId } : c
      ),
      selectedIds: new Set(),
      lastClickedId: null,
    })

    try {
      await window.agent.conversations.moveMany(ids, folderId)
    } catch {
      set({ conversations: prev })
    }
  },

  loadConversations: async () => {
    set({ isLoading: true })
    const conversations = await window.agent.conversations.list()
    set({ conversations, isLoading: false })
  },

  loadFolders: async () => {
    const folders = await window.agent.folders.list()
    set({ folders })
  },

  createConversation: async (title?: string, folderId?: number) => {
    const conversation = await window.agent.conversations.create(title, folderId)
    set((s) => ({ conversations: [conversation, ...s.conversations] }))
    set({ activeConversationId: conversation.id })
    if (WEB_MODE) sessionStorage.setItem(SESSION_KEY, String(conversation.id))
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
    if (WEB_MODE) {
      if (id !== null) sessionStorage.setItem(SESSION_KEY, String(id))
      else sessionStorage.removeItem(SESSION_KEY)
    }
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
      // Default: reparent to default folder
      set((s) => ({
        folders: s.folders.filter((f) => f.id !== id),
      }))
      try {
        await window.agent.folders.delete(id)
        // Reload conversations — main has reparented them to default folder
        await get().loadConversations()
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

  forkConversation: async (conversationId, messageId) => {
    const conversation = await window.agent.conversations.fork(conversationId, messageId)
    set((s) => ({ conversations: [conversation, ...s.conversations] }))
    set({ activeConversationId: conversation.id })
    if (WEB_MODE) sessionStorage.setItem(SESSION_KEY, String(conversation.id))
    return conversation
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
