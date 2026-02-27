import { create } from 'zustand'
import type { Message, Attachment, StreamChunk, StreamPart, AskUserQuestion, McpConnectionStatus, NotificationEvent, NotificationConfig } from '../../shared/types'
import { DEFAULT_NOTIFICATION_CONFIG, NOTIFICATION_EVENTS } from '../../shared/constants'
import { useSettingsStore } from './settingsStore'
import { playCompletionSound, playErrorSound } from '../utils/notificationSound'

export interface QueuedMessage {
  id: string
  content: string
  attachments?: Attachment[]
  createdAt: number
}

interface ChatState {
  messages: Message[]
  clearedAt: string | null
  compactSummary: string | null
  isCompacting: boolean
  isStreaming: boolean
  streamParts: StreamPart[]
  streamingContent: string
  streamBuffers: Record<number, StreamPart[]>
  isLoading: boolean
  error: string | null
  activeConversationId: number | null
  messageQueues: Record<number, QueuedMessage[]>
  queuePaused: Record<number, boolean>

  loadMessages: (conversationId: number) => Promise<void>
  sendMessage: (conversationId: number, content: string, attachments?: Attachment[]) => Promise<void>
  stopGeneration: () => Promise<void>
  regenerateLastResponse: (conversationId: number) => Promise<void>
  editMessage: (messageId: number, content: string) => Promise<void>
  setActiveConversation: (id: number | null) => void
  clearChat: () => void
  clearContext: (conversationId: number) => Promise<void>
  compactContext: (conversationId: number) => Promise<void>
  addToQueue: (conversationId: number, content: string, attachments?: Attachment[]) => void
  removeFromQueue: (conversationId: number, messageId: string) => void
  editQueuedMessage: (conversationId: number, messageId: string, newContent: string) => void
  reorderQueue: (conversationId: number, fromIndex: number, toIndex: number) => void
  clearQueue: (conversationId: number) => void
  pauseQueue: (conversationId: number) => void
  resumeQueue: (conversationId: number) => void
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

function getNotificationConfig(settings: Record<string, string>): NotificationConfig {
  const raw = settings.notificationConfig
  if (!raw) return DEFAULT_NOTIFICATION_CONFIG
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationConfig>
    return { ...DEFAULT_NOTIFICATION_CONFIG, ...parsed }
  } catch {
    return DEFAULT_NOTIFICATION_CONFIG
  }
}

function mapToNotificationEvent(stopReason?: string, resultSubtype?: string): NotificationEvent {
  if (stopReason === 'refusal') return 'refusal'
  if (stopReason === 'max_tokens') return 'max_tokens'
  if (resultSubtype === 'error_max_turns') return 'error_max_turns'
  if (resultSubtype === 'error_max_budget_usd') return 'error_max_budget'
  if (resultSubtype === 'error_during_execution') return 'error_execution'
  return 'success'
}

function getEventLabel(event: NotificationEvent): string {
  const entry = NOTIFICATION_EVENTS.find((e) => e.key === event)
  return entry?.label ?? 'Response complete'
}

function shouldShowDesktopNotification(mode: string): boolean {
  switch (mode) {
    case 'hidden': return document.hidden
    case 'always': return true
    case 'unfocused':
    default: return !document.hasFocus()
  }
}

function randomQueueDelay(): Promise<void> {
  const ms = 1000 + Math.random() * 4000 // 1–5 seconds
  return new Promise((r) => setTimeout(r, ms))
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

async function streamOperation(
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
  conversationId: number,
  ipcCall: () => Promise<unknown>,
  errorLabel: string
): Promise<void> {
  try {
    await ipcCall()
    await new Promise((r) => setTimeout(r, 50))
    if (get().activeConversationId === conversationId) {
      await get().loadMessages(conversationId)
    }
    set(cleanupStreamBuffer(get(), conversationId))

    // Drain queue: send next queued message if not paused
    const queue = get().messageQueues[conversationId]
    if (queue?.length && !get().queuePaused[conversationId]) {
      const next = queue[0]
      await randomQueueDelay()
      // Re-check pause after delay — user may have paused while waiting
      if (!get().queuePaused[conversationId]) {
        const fresh = get().messageQueues[conversationId] || []
        const rest = fresh.slice(1)
        set({
          messageQueues: rest.length
            ? { ...get().messageQueues, [conversationId]: rest }
            : (() => { const { [conversationId]: _, ...r } = get().messageQueues; return r })(),
        })
        await get().sendMessage(conversationId, next.content, next.attachments)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : errorLabel
    const cleanup = cleanupStreamBuffer(get(), conversationId)
    set(get().activeConversationId === conversationId
      ? { error: msg, ...cleanup, queuePaused: { ...get().queuePaused, [conversationId]: true } }
      : { ...cleanup, queuePaused: { ...get().queuePaused, [conversationId]: true } }
    )
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  clearedAt: null,
  compactSummary: null,
  isCompacting: false,
  isStreaming: false,
  streamParts: [],
  streamingContent: '',
  streamBuffers: {},
  isLoading: false,
  error: null,
  activeConversationId: null,
  messageQueues: {},
  queuePaused: {},

  loadMessages: async (conversationId: number) => {
    set((s) => ({ isLoading: true, error: s.error ?? null }))
    try {
      const convo = await window.agent.conversations.get(conversationId)
      set({ messages: convo.messages, clearedAt: convo.cleared_at ?? null, compactSummary: convo.compact_summary ?? null, isLoading: false })
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

    await streamOperation(
      get, set, conversationId,
      () => window.agent.messages.send(conversationId, content, attachments),
      'Failed to send message'
    )
  },

  stopGeneration: async () => {
    const convId = get().activeConversationId
    if (convId) {
      set({ queuePaused: { ...get().queuePaused, [convId]: true } })
      await window.agent.messages.stop(convId)
    }
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
      queuePaused: { ...get().queuePaused, [conversationId]: true },
    }))

    await streamOperation(
      get, set, conversationId,
      () => window.agent.messages.regenerate(conversationId),
      'Failed to regenerate'
    )
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
        queuePaused: convId != null ? { ...s.queuePaused, [convId]: true } : s.queuePaused,
      }
    })

    if (convId != null) {
      await streamOperation(
        get, set, convId,
        () => window.agent.messages.edit(messageId, content),
        'Failed to edit message'
      )
    } else {
      try {
        await window.agent.messages.edit(messageId, content)
        set({ isStreaming: false, streamParts: [], streamingContent: '' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to edit message'
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
    set({ messages: [], clearedAt: null, compactSummary: null, isCompacting: false, streamParts: [], streamingContent: '', streamBuffers: {}, isStreaming: false, error: null, activeConversationId: null })
  },

  clearContext: async (conversationId: number) => {
    const clearedAt = new Date().toISOString()
    await window.agent.conversations.update(conversationId, { cleared_at: clearedAt, compact_summary: null } as any)
    set({ clearedAt, compactSummary: null })
  },

  compactContext: async (conversationId: number) => {
    set({ isCompacting: true, error: null })
    try {
      const { summary, clearedAt } = await window.agent.messages.compact(conversationId)
      set({ clearedAt, compactSummary: summary || null, isCompacting: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to compact context'
      set({ error: msg, isCompacting: false })
    }
  },

  addToQueue: (conversationId, content, attachments?) => {
    set((s) => {
      const queue = s.messageQueues[conversationId] || []
      return {
        messageQueues: {
          ...s.messageQueues,
          [conversationId]: [...queue, {
            id: crypto.randomUUID(),
            content,
            attachments,
            createdAt: Date.now(),
          }],
        },
      }
    })
  },

  removeFromQueue: (conversationId, messageId) => {
    set((s) => {
      const queue = (s.messageQueues[conversationId] || []).filter((m) => m.id !== messageId)
      if (queue.length === 0) {
        const { [conversationId]: _, ...rest } = s.messageQueues
        return { messageQueues: rest }
      }
      return { messageQueues: { ...s.messageQueues, [conversationId]: queue } }
    })
  },

  editQueuedMessage: (conversationId, messageId, newContent) => {
    set((s) => {
      const queue = (s.messageQueues[conversationId] || []).map((m) =>
        m.id === messageId ? { ...m, content: newContent } : m
      )
      return { messageQueues: { ...s.messageQueues, [conversationId]: queue } }
    })
  },

  reorderQueue: (conversationId, fromIndex, toIndex) => {
    set((s) => {
      const queue = [...(s.messageQueues[conversationId] || [])]
      const [item] = queue.splice(fromIndex, 1)
      queue.splice(toIndex, 0, item)
      return { messageQueues: { ...s.messageQueues, [conversationId]: queue } }
    })
  },

  clearQueue: (conversationId) => {
    set((s) => {
      const { [conversationId]: _, ...rest } = s.messageQueues
      const { [conversationId]: __, ...pausedRest } = s.queuePaused
      return { messageQueues: rest, queuePaused: pausedRest }
    })
  },

  pauseQueue: (conversationId) => {
    set((s) => ({
      queuePaused: { ...s.queuePaused, [conversationId]: true },
    }))
  },

  resumeQueue: (conversationId) => {
    const { [conversationId]: _, ...rest } = get().queuePaused
    set({ queuePaused: rest })

    // If not currently streaming, drain immediately
    const isConvStreaming = conversationId in get().streamBuffers
    const queue = get().messageQueues[conversationId]
    if (!isConvStreaming && queue?.length) {
      const next = queue[0]
      randomQueueDelay().then(() => {
        // Re-check pause after delay — user may have paused while waiting
        if (!get().queuePaused[conversationId]) {
          const fresh = get().messageQueues[conversationId] || []
          const rest = fresh.slice(1)
          set({
            messageQueues: rest.length
              ? { ...get().messageQueues, [conversationId]: rest }
              : (() => { const { [conversationId]: _, ...r } = get().messageQueues; return r })(),
          })
          get().sendMessage(conversationId, next.content, next.attachments)
        }
      })
    }
  },
}))

// Conversation-updated listener — reload messages when another window finishes streaming
if (typeof window !== 'undefined' && window.agent?.events?.onConversationUpdated) {
  window.agent.events.onConversationUpdated((conversationId: number) => {
    const store = useChatStore.getState()
    if (store.activeConversationId === conversationId && !(conversationId in store.streamBuffers)) {
      store.loadMessages(conversationId)
    }
  })
}

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

    case 'system_message': {
      if (chunk.content) {
        const parts = [...(store.streamBuffers[bufferKey] || [])]
        parts.push({
          type: 'system_message',
          content: chunk.content,
          hookName: chunk.hookName,
          hookEvent: chunk.hookEvent,
        })
        commitParts(parts)
      }
      break
    }

    case 'done': {
      const doneSettings = useSettingsStore.getState().settings
      console.log('[notif:done] master toggle notificationSounds =', doneSettings.notificationSounds, '| stopReason =', chunk.stopReason)
      if (doneSettings.notificationSounds === 'true' && chunk.stopReason !== 'aborted') {
        const event = mapToNotificationEvent(chunk.stopReason, chunk.resultSubtype)
        console.log('[notif:done] event =', event, '| stopReason =', chunk.stopReason, '| resultSubtype =', chunk.resultSubtype)
        const config = getNotificationConfig(doneSettings)
        const eventConfig = config[event]
        console.log('[notif:done] eventConfig =', JSON.stringify(eventConfig))
        if (eventConfig.sound) {
          if (event === 'success') {
            playCompletionSound()
          } else {
            playErrorSound()
          }
        }
        const doneDesktopMode = doneSettings.notificationDesktopMode ?? 'unfocused'
        console.log('[notif:done] desktop =', eventConfig.desktop, '| mode =', doneDesktopMode, '| shouldShow =', shouldShowDesktopNotification(doneDesktopMode))
        if (eventConfig.desktop && shouldShowDesktopNotification(doneDesktopMode)) {
          console.log('[notif:done] >>> showNotification called:', getEventLabel(event))
          window.agent.system.showNotification('Agent Desktop', getEventLabel(event)).catch(() => {})
        }
      }
      useChatStore.setState(cleanupStreamBuffer(store, bufferKey))
      break
    }

    case 'error': {
      const errSettings = useSettingsStore.getState().settings
      console.log('[notif:error] master toggle notificationSounds =', errSettings.notificationSounds)
      if (errSettings.notificationSounds === 'true') {
        const config = getNotificationConfig(errSettings)
        const eventConfig = config.error_js
        console.log('[notif:error] eventConfig =', JSON.stringify(eventConfig))
        if (eventConfig.sound) {
          playErrorSound()
        }
        const errDesktopMode = errSettings.notificationDesktopMode ?? 'unfocused'
        console.log('[notif:error] desktop =', eventConfig.desktop, '| mode =', errDesktopMode, '| shouldShow =', shouldShowDesktopNotification(errDesktopMode))
        if (eventConfig.desktop && shouldShowDesktopNotification(errDesktopMode)) {
          console.log('[notif:error] >>> showNotification called')
          window.agent.system.showNotification('Agent Desktop', getEventLabel('error_js')).catch(() => {})
        }
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
