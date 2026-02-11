import { create } from 'zustand'
import type { Message, Attachment, StreamChunk, StreamPart, AskUserQuestion, McpConnectionStatus } from '../../shared/types'
import { useSettingsStore } from './settingsStore'
import { playCompletionSound, playErrorSound } from '../utils/notificationSound'

interface ChatState {
  messages: Message[]
  isStreaming: boolean
  streamParts: StreamPart[]
  streamingContent: string
  streamBuffers: Record<number, StreamPart[]>
  isLoading: boolean
  error: string | null
  activeConversationId: number | null

  loadMessages: (conversationId: number) => Promise<void>
  sendMessage: (conversationId: number, content: string, attachments?: Attachment[]) => Promise<void>
  stopGeneration: () => Promise<void>
  regenerateLastResponse: (conversationId: number) => Promise<void>
  editMessage: (messageId: number, content: string) => Promise<void>
  setActiveConversation: (id: number | null) => void
  clearChat: () => void
}

function getTextFromParts(parts: StreamPart[]): string {
  return parts.filter((p) => p.type === 'text').map((p) => p.content).join('')
}

function syncViewFromBuffer(
  convId: number | null,
  buffers: Record<number, StreamPart[]>
): { streamParts: StreamPart[]; streamingContent: string } {
  const parts = (convId != null && buffers[convId]) ? buffers[convId] : []
  return { streamParts: parts, streamingContent: getTextFromParts(parts) }
}

function cleanupStreamBuffer(
  state: { streamBuffers: Record<number, StreamPart[]>; activeConversationId: number | null },
  conversationId: number
) {
  const { [conversationId]: _, ...rest } = state.streamBuffers
  const isStreaming = state.activeConversationId != null && state.activeConversationId in rest
  return {
    streamBuffers: rest,
    isStreaming,
    ...(state.activeConversationId === conversationId ? { streamParts: [], streamingContent: '' } : {}),
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamParts: [],
  streamingContent: '',
  streamBuffers: {},
  isLoading: false,
  error: null,
  activeConversationId: null,

  loadMessages: async (conversationId: number) => {
    set((s) => ({ isLoading: true, error: s.error ?? null }))
    try {
      const convo = await window.agent.conversations.get(conversationId)
      set({ messages: convo.messages, isLoading: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load messages'
      set({ error: msg, isLoading: false })
    }
  },

  sendMessage: async (conversationId: number, content: string, attachments?: Attachment[]) => {
    const userMsg: Message = {
      id: Date.now(),
      conversation_id: conversationId,
      role: 'user',
      content,
      attachments: JSON.stringify(attachments || []),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    set((s) => ({
      messages: [...s.messages, userMsg],
      isStreaming: true,
      streamParts: [],
      streamingContent: '',
      streamBuffers: { ...s.streamBuffers, [conversationId]: [] },
      error: null,
      activeConversationId: conversationId,
    }))

    try {
      await window.agent.messages.send(conversationId, content, attachments)
      // Small delay to let stream listener process the 'done' chunk
      await new Promise((r) => setTimeout(r, 50))
      // Only update UI if this conversation is still active
      if (get().activeConversationId === conversationId) {
        await get().loadMessages(conversationId)
      }
      set(cleanupStreamBuffer(get(), conversationId))
    } catch (err) {
      console.error('sendMessage error:', err)
      const msg = err instanceof Error ? err.message : 'Failed to send message'
      const cleanup = cleanupStreamBuffer(get(), conversationId)
      set(get().activeConversationId === conversationId ? { error: msg, ...cleanup } : cleanup)
    }
  },

  stopGeneration: async () => {
    await window.agent.messages.stop()
  },

  regenerateLastResponse: async (conversationId: number) => {
    // Remove last assistant message optimistically
    set((s) => ({
      messages: s.messages.filter(
        (m, i) =>
          !(m.role === 'assistant' && i === s.messages.length - 1)
      ),
      isStreaming: true,
      streamParts: [],
      streamingContent: '',
      streamBuffers: { ...get().streamBuffers, [conversationId]: [] },
      error: null,
    }))

    try {
      await window.agent.messages.regenerate(conversationId)
      await new Promise((r) => setTimeout(r, 50))
      if (get().activeConversationId === conversationId) {
        await get().loadMessages(conversationId)
      }
      set(cleanupStreamBuffer(get(), conversationId))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to regenerate'
      const cleanup = cleanupStreamBuffer(get(), conversationId)
      set(get().activeConversationId === conversationId ? { error: msg, ...cleanup } : cleanup)
    }
  },

  editMessage: async (messageId: number, content: string) => {
    const convId = get().activeConversationId
    set((s) => {
      const editIdx = s.messages.findIndex((m) => m.id === messageId)
      const truncatedMessages =
        editIdx >= 0
          ? s.messages.slice(0, editIdx + 1).map((m) =>
              m.id === messageId ? { ...m, content } : m
            )
          : s.messages

      return {
        messages: truncatedMessages,
        isStreaming: true,
        streamParts: [],
        streamingContent: '',
        streamBuffers: convId != null ? { ...s.streamBuffers, [convId]: [] } : s.streamBuffers,
        error: null,
      }
    })

    try {
      await window.agent.messages.edit(messageId, content)
      await new Promise((r) => setTimeout(r, 50))
      if (convId && get().activeConversationId === convId) {
        await get().loadMessages(convId)
      }
      if (convId != null) {
        set(cleanupStreamBuffer(get(), convId))
      } else {
        set({ isStreaming: false, streamParts: [], streamingContent: '' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to edit message'
      if (convId != null) {
        const cleanup = cleanupStreamBuffer(get(), convId)
        set(get().activeConversationId === convId ? { error: msg, ...cleanup } : cleanup)
      } else {
        set({ error: msg, isStreaming: false })
      }
    }
  },

  setActiveConversation: (id: number | null) => {
    const { activeConversationId: prevId, streamBuffers } = get()
    const isActiveStreaming = id != null && id in streamBuffers
    set({
      activeConversationId: id,
      isStreaming: isActiveStreaming,
      // Clear stale messages when switching conversations to prevent showing wrong conv's data
      ...(id !== prevId ? { messages: [] } : {}),
      ...syncViewFromBuffer(id, streamBuffers),
    })
  },

  clearChat: () => {
    set({ messages: [], streamParts: [], streamingContent: '', streamBuffers: {}, isStreaming: false, error: null, activeConversationId: null })
  },
}))

// Stream listener — guarded against preload not being ready
if (typeof window !== 'undefined' && window.agent?.messages?.onStream) {
window.agent.messages.onStream((chunk: StreamChunk) => {
  const store = useChatStore.getState()

  // Route chunk to the correct buffer by conversationId
  const bufferKey = chunk.conversationId ?? store.activeConversationId
  // Drop chunks for conversations without an active buffer (not streaming)
  if (bufferKey == null || !(bufferKey in store.streamBuffers)) {
    return
  }

  const isActiveView = bufferKey === store.activeConversationId

  // Helper: update buffer and optionally sync the view
  function commitParts(parts: StreamPart[]) {
    const buffers = { ...store.streamBuffers, [bufferKey]: parts }
    if (isActiveView) {
      useChatStore.setState({ streamBuffers: buffers, streamParts: parts, streamingContent: getTextFromParts(parts) })
    } else {
      useChatStore.setState({ streamBuffers: buffers })
    }
  }

  switch (chunk.type) {
    case 'text':
      if (chunk.content) {
        const parts = [...(store.streamBuffers[bufferKey] || [])]
        const lastPart = parts[parts.length - 1]
        if (lastPart && lastPart.type === 'text') {
          parts[parts.length - 1] = { type: 'text', content: lastPart.content + chunk.content }
        } else {
          parts.push({ type: 'text', content: chunk.content })
        }
        commitParts(parts)
      }
      break

    case 'tool_start': {
      const parts = [...(store.streamBuffers[bufferKey] || [])]
      const toolName = chunk.toolName || chunk.content || 'tool'
      const toolId = chunk.toolId || `tool_${Date.now()}`
      parts.push({ type: 'tool', name: toolName, id: toolId, status: 'running' })
      commitParts(parts)
      break
    }

    case 'tool_input': {
      const parts = [...(store.streamBuffers[bufferKey] || [])]
      const toolId = chunk.toolId
      let toolInput: Record<string, unknown> = {}
      if (chunk.toolInput) {
        try { toolInput = JSON.parse(chunk.toolInput) as Record<string, unknown> } catch { /* ignore */ }
      }
      // Find the running tool and add input
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        if (p.type === 'tool' && p.status === 'running' && (!toolId || p.id === toolId)) {
          parts[i] = { ...p, input: toolInput }
          break
        }
      }
      commitParts(parts)
      break
    }

    case 'tool_result': {
      const parts = [...(store.streamBuffers[bufferKey] || [])]
      const toolId = chunk.toolId
      let found = false
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        if (p.type === 'tool' && p.status === 'running' && (!toolId || p.id === toolId)) {
          parts[i] = {
            ...p,
            status: 'done',
            summary: chunk.content || '',
            output: chunk.toolOutput || chunk.content || '',
          }
          // If input was sent with the result chunk, set it too
          if (chunk.toolInput && !p.input) {
            try {
              parts[i] = { ...parts[i], input: JSON.parse(chunk.toolInput) as Record<string, unknown> }
            } catch { /* ignore invalid JSON */ }
          }
          found = true
          break
        }
      }
      if (!found) {
        let toolInput: Record<string, unknown> | undefined
        if (chunk.toolInput) {
          try { toolInput = JSON.parse(chunk.toolInput) as Record<string, unknown> } catch { /* ignore */ }
        }
        parts.push({
          type: 'tool',
          name: chunk.toolName || 'tool',
          id: chunk.toolId || `tool_${Date.now()}`,
          status: 'done',
          summary: chunk.content || '',
          output: chunk.toolOutput || chunk.content || '',
          input: toolInput,
        })
      }
      commitParts(parts)
      break
    }

    case 'tool_approval': {
      if (chunk.requestId && chunk.toolName) {
        const parts = [...(store.streamBuffers[bufferKey] || [])]
        let toolInput: Record<string, unknown> = {}
        if (chunk.toolInput) {
          try { toolInput = JSON.parse(chunk.toolInput) as Record<string, unknown> } catch { /* invalid JSON */ }
        }
        parts.push({ type: 'tool_approval', requestId: chunk.requestId, toolName: chunk.toolName, toolInput })
        commitParts(parts)
      }
      break
    }

    case 'ask_user': {
      if (chunk.requestId && chunk.questions) {
        const parts = [...(store.streamBuffers[bufferKey] || [])]
        let questions: AskUserQuestion[] = []
        try { questions = JSON.parse(chunk.questions) as AskUserQuestion[] } catch { /* invalid JSON */ }
        parts.push({ type: 'ask_user', requestId: chunk.requestId, questions })
        commitParts(parts)
      }
      break
    }

    case 'mcp_status': {
      if (chunk.mcpServers) {
        const parts = [...(store.streamBuffers[bufferKey] || [])]
        let servers: McpConnectionStatus[] = []
        try { servers = JSON.parse(chunk.mcpServers) as McpConnectionStatus[] } catch { /* invalid JSON */ }
        if (servers.length > 0) {
          parts.push({ type: 'mcp_status', servers })
          commitParts(parts)
        }
      }
      break
    }

    case 'done': {
      const doneSettings = useSettingsStore.getState().settings
      if (doneSettings.notificationSounds === 'true') {
        playCompletionSound()
        if (document.hidden) {
          window.agent.system.showNotification('Agent Desktop', 'Response complete').catch(() => {})
        }
      }
      useChatStore.setState(cleanupStreamBuffer(store, bufferKey))
      break
    }

    case 'error': {
      const errSettings = useSettingsStore.getState().settings
      if (errSettings.notificationSounds === 'true') {
        playErrorSound()
      }
      useChatStore.setState({
        error: chunk.content ?? 'Stream error',
        ...cleanupStreamBuffer(store, bufferKey),
      })
      break
    }
  }
})
}
