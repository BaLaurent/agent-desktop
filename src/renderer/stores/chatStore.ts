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

export interface TaskNotification {
  taskId?: string
  taskStatus?: string
  summary: string
  outputFile?: string
  receivedAt: number
}

interface ChatState {
  messages: Message[]
  clearedAt: string | null
  compactSummary: string | null
  isCompacting: boolean
  isStreaming: boolean
  streamParts: StreamPart[]
  streamingContent: string
  isLoading: boolean
  error: string | null
  activeConversationId: number | null
  messageQueues: Record<number, QueuedMessage[]>
  queuePaused: Record<number, boolean>
  queueEditLocked: Record<number, boolean>
  taskNotifications: Record<number, TaskNotification[]>

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
  lockQueueForEdit: (conversationId: number) => void
  unlockQueueForEdit: (conversationId: number) => void
}

// --- Module-level stream buffer map (non-reactive) ---
// Only the active conversation's streamParts/streamingContent are in Zustand state.
// Background conversation buffers live here and never trigger renders.
const streamBuffersMap = new Map<number, StreamPart[]>()

/** Accumulated text content per conversation — avoids O(n) recomputation on every chunk */
const streamTextMap = new Map<number, string>()

/** Check if a conversation has an active stream buffer */
export function hasStreamBuffer(conversationId: number): boolean {
  return streamBuffersMap.has(conversationId)
}

function getTextFromParts(parts: StreamPart[]): string {
  return parts.filter((p) => p.type === 'text').map((p) => p.content).join('')
}

function syncViewFromBuffer(
  convId: number | null,
): { streamParts: StreamPart[]; streamingContent: string } {
  if (convId == null) return { streamParts: [], streamingContent: '' }
  const parts = streamBuffersMap.get(convId)
  if (!parts) return { streamParts: [], streamingContent: '' }
  return { streamParts: parts, streamingContent: streamTextMap.get(convId) ?? getTextFromParts(parts) }
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
  const ms = 1000 + Math.random() * 4000 // 1-5 seconds
  return new Promise((r) => setTimeout(r, ms))
}

function cleanupStreamBuffer(
  activeConversationId: number | null,
  conversationId: number
) {
  streamBuffersMap.delete(conversationId)
  streamTextMap.delete(conversationId)
  const isStreaming = activeConversationId != null && streamBuffersMap.has(activeConversationId)
  return {
    isStreaming,
    ...(activeConversationId === conversationId ? { streamParts: [], streamingContent: '' } : {}),
  }
}

/** Pop next item from queue and return it, or null if empty/paused */
function popQueue(get: () => ChatState, conversationId: number): QueuedMessage | null {
  if (get().queuePaused[conversationId] || get().queueEditLocked[conversationId]) return null
  const queue = get().messageQueues[conversationId]
  if (!queue?.length) return null
  const next = queue[0]
  const rest = queue.slice(1)
  useChatStore.setState({
    messageQueues: rest.length
      ? { ...get().messageQueues, [conversationId]: rest }
      : (() => { const { [conversationId]: _, ...r } = get().messageQueues; return r })(),
  })
  return next
}

/** Process a queued message: handle slash commands (/clear, /compact) and macros, or send normally */
async function processQueuedMessage(
  get: () => ChatState,
  conversationId: number,
  content: string,
  attachments?: Attachment[]
): Promise<void> {
  const trimmed = content.trim()

  // Client-side slash commands -- don't start a stream, so must continue drain
  if (trimmed === '/clear' || trimmed === '/compact') {
    if (trimmed === '/clear') {
      await get().clearContext(conversationId)
    } else {
      await get().compactContext(conversationId)
    }
    // Continue draining: these don't trigger streamOperation, so drain manually
    const next = popQueue(get, conversationId)
    if (next) {
      await randomQueueDelay()
      if (!get().queuePaused[conversationId]) {
        await processQueuedMessage(get, conversationId, next.content, next.attachments)
      }
    }
    return
  }

  // Macro expansion: /name -> load macro -> prepend messages to queue
  if (/^\/[\w-]+$/.test(trimmed) && typeof window !== 'undefined' && window.agent?.macros?.load) {
    const messages = await window.agent.macros.load(trimmed.slice(1))
    if (messages) {
      const [first, ...rest] = messages
      if (rest.length) {
        const existing = get().messageQueues[conversationId] || []
        const queued = rest.map((msg) => ({
          id: crypto.randomUUID(),
          content: msg,
          createdAt: Date.now(),
        }))
        useChatStore.setState({
          messageQueues: {
            ...get().messageQueues,
            [conversationId]: [...queued, ...existing],
          },
        })
      }
      // Process first message recursively (could be a slash command or another macro)
      await processQueuedMessage(get, conversationId, first)
      return
    }
  }

  // Regular message -- send to AI (streamOperation will drain the rest)
  await get().sendMessage(conversationId, content, attachments)
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
    set(cleanupStreamBuffer(get().activeConversationId, conversationId))

    // Drain queue: process next queued message if not paused
    const next = popQueue(get, conversationId)
    if (next) {
      await randomQueueDelay()
      if (!get().queuePaused[conversationId]) {
        await processQueuedMessage(get, conversationId, next.content, next.attachments)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : errorLabel
    const cleanup = cleanupStreamBuffer(get().activeConversationId, conversationId)
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
  isLoading: false,
  error: null,
  activeConversationId: null,
  messageQueues: {},
  queuePaused: {},
  queueEditLocked: {},
  taskNotifications: {},

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

    streamBuffersMap.set(conversationId, [])
    streamTextMap.set(conversationId, '')
    set((s) => {
      const { [conversationId]: _, ...restNotifs } = s.taskNotifications
      return {
        messages: [...s.messages, userMsg],
        isStreaming: true,
        streamParts: [],
        streamingContent: '',
        error: null,
        activeConversationId: conversationId,
        taskNotifications: restNotifs,
      }
    })

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
    streamBuffersMap.set(conversationId, [])
    streamTextMap.set(conversationId, '')
    set((s) => ({
      messages: s.messages.filter(
        (m, i) =>
          !(m.role === 'assistant' && i === s.messages.length - 1)
      ),
      isStreaming: true,
      streamParts: [],
      streamingContent: '',
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
    if (convId != null) {
      streamBuffersMap.set(convId, [])
      streamTextMap.set(convId, '')
    }
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
    const { activeConversationId: prevId } = get()
    const isActiveStreaming = id != null && streamBuffersMap.has(id)
    set({
      activeConversationId: id,
      isStreaming: isActiveStreaming,
      // Clear stale data when switching conversations to prevent showing wrong conv's data
      ...(id !== prevId ? { messages: [], clearedAt: null, compactSummary: null } : {}),
      ...syncViewFromBuffer(id),
    })
  },

  clearChat: () => {
    streamBuffersMap.clear()
    streamTextMap.clear()
    set({ messages: [], clearedAt: null, compactSummary: null, isCompacting: false, streamParts: [], streamingContent: '', isStreaming: false, error: null, activeConversationId: null })
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
      const { [conversationId]: ___, ...editRest } = s.queueEditLocked
      return { messageQueues: rest, queuePaused: pausedRest, queueEditLocked: editRest }
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
    const isConvStreaming = streamBuffersMap.has(conversationId)
    if (!isConvStreaming) {
      const next = popQueue(get, conversationId)
      if (next) {
        randomQueueDelay().then(() => {
          if (!get().queuePaused[conversationId]) {
            processQueuedMessage(get, conversationId, next.content, next.attachments)
          }
        })
      }
    }
  },

  lockQueueForEdit: (conversationId) => {
    set((s) => ({ queueEditLocked: { ...s.queueEditLocked, [conversationId]: true } }))
  },

  unlockQueueForEdit: (conversationId) => {
    const { [conversationId]: _, ...rest } = get().queueEditLocked
    set({ queueEditLocked: rest })

    // Drain if not paused and not streaming
    if (!get().queuePaused[conversationId]) {
      const isConvStreaming = streamBuffersMap.has(conversationId)
      if (!isConvStreaming) {
        const next = popQueue(get, conversationId)
        if (next) {
          randomQueueDelay().then(() => {
            if (!get().queuePaused[conversationId] && !get().queueEditLocked[conversationId]) {
              processQueuedMessage(get, conversationId, next.content, next.attachments)
            }
          })
        }
      }
    }
  },
}))

// Expose streamBuffersMap for tests and external checks (e.g. conversation-updated listener)
export { streamBuffersMap as _streamBuffersMap, streamTextMap as _streamTextMap }

// Conversation-updated listener -- reload messages when another window finishes streaming
if (typeof window !== 'undefined' && window.agent?.events?.onConversationUpdated) {
  window.agent.events.onConversationUpdated((conversationId: number) => {
    const store = useChatStore.getState()
    if (store.activeConversationId === conversationId && !streamBuffersMap.has(conversationId)) {
      store.loadMessages(conversationId)
    }
  })
}

// Stream listener -- guarded against preload not being ready
if (typeof window !== 'undefined' && window.agent?.messages?.onStream) {
window.agent.messages.onStream((chunk: StreamChunk) => {
  const store = useChatStore.getState()

  // Route chunk to the correct buffer by conversationId
  const bufferKey = chunk.conversationId ?? store.activeConversationId

  // task_notification can arrive between turns (no active stream buffer)
  // Handle it before the buffer guard so it's never silently dropped
  if (chunk.type === 'task_notification') {
    const convId = bufferKey ?? store.activeConversationId
    if (convId != null) {
      const notification: TaskNotification = {
        taskId: chunk.taskId,
        taskStatus: chunk.taskStatus,
        summary: chunk.content || 'Agent task completed',
        outputFile: chunk.outputFile,
        receivedAt: Date.now(),
      }
      const existing = store.taskNotifications[convId] || []
      // Task 1.4: Batch setState — build full update, then call setState once
      const stateUpdate: Partial<ChatState> = {
        taskNotifications: { ...store.taskNotifications, [convId]: [...existing, notification] },
      }
      // Also add inline if streaming
      if (streamBuffersMap.has(convId)) {
        const parts = [...(streamBuffersMap.get(convId) || [])]
        parts.push({
          type: 'task_notification',
          summary: notification.summary,
          taskId: chunk.taskId,
          taskStatus: chunk.taskStatus,
          outputFile: chunk.outputFile,
        })
        streamBuffersMap.set(convId, parts)
        // streamTextMap unchanged — task_notification is not text
        if (convId === store.activeConversationId) {
          stateUpdate.streamParts = parts
          stateUpdate.streamingContent = streamTextMap.get(convId) ?? getTextFromParts(parts)
        }
      }
      useChatStore.setState(stateUpdate)
      // Trigger notification sound + desktop notification
      const notifSettings = useSettingsStore.getState().settings
      if (notifSettings.notificationSounds === 'true') {
        playCompletionSound()
        const doneDesktopMode = notifSettings.notificationDesktopMode ?? 'unfocused'
        if (shouldShowDesktopNotification(doneDesktopMode)) {
          const status = chunk.taskStatus === 'failed' ? 'failed' : 'completed'
          window.agent.system.showNotification('Agent Desktop', `Background agent ${status}`).catch(() => {})
        }
      }
    }
    return
  }

  // Drop chunks for conversations without an active buffer (not streaming)
  if (bufferKey == null || !streamBuffersMap.has(bufferKey)) {
    return
  }

  const isActiveView = bufferKey === store.activeConversationId

  // Helper: update module-level buffer and optionally sync the reactive view
  function commitParts(parts: StreamPart[], textContent?: string) {
    streamBuffersMap.set(bufferKey, parts)
    const text = textContent ?? (streamTextMap.get(bufferKey) ?? getTextFromParts(parts))
    streamTextMap.set(bufferKey, text)
    if (isActiveView) {
      useChatStore.setState({ streamParts: parts, streamingContent: text })
    }
  }

  switch (chunk.type) {
    case 'text':
      if (chunk.content) {
        const parts = [...(streamBuffersMap.get(bufferKey) || [])]
        const lastPart = parts[parts.length - 1]
        if (lastPart && lastPart.type === 'text') {
          parts[parts.length - 1] = { type: 'text', content: lastPart.content + chunk.content }
        } else {
          parts.push({ type: 'text', content: chunk.content })
        }
        // Task 1.3: Incremental text accumulation instead of filter+map+join
        const prevText = streamTextMap.get(bufferKey) ?? ''
        commitParts(parts, prevText + chunk.content)
      }
      break

    case 'tool_start': {
      const parts = [...(streamBuffersMap.get(bufferKey) || [])]
      const toolName = chunk.toolName || chunk.content || 'tool'
      const toolId = chunk.toolId || `tool_${Date.now()}`
      parts.push({ type: 'tool', name: toolName, id: toolId, status: 'running' })
      commitParts(parts)
      break
    }

    case 'tool_input': {
      const parts = [...(streamBuffersMap.get(bufferKey) || [])]
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
      const parts = [...(streamBuffersMap.get(bufferKey) || [])]
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
        const parts = [...(streamBuffersMap.get(bufferKey) || [])]
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
        const parts = [...(streamBuffersMap.get(bufferKey) || [])]
        let questions: AskUserQuestion[] = []
        try { questions = JSON.parse(chunk.questions) as AskUserQuestion[] } catch { /* invalid JSON */ }
        parts.push({ type: 'ask_user', requestId: chunk.requestId, questions })
        commitParts(parts)
      }
      break
    }

    case 'mcp_status': {
      if (chunk.mcpServers) {
        const parts = [...(streamBuffersMap.get(bufferKey) || [])]
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
        const parts = [...(streamBuffersMap.get(bufferKey) || [])]
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

    case 'retry': {
      const parts = [...(streamBuffersMap.get(bufferKey) || [])]
      parts.push({
        type: 'retry',
        message: chunk.content || 'Retrying...',
        attempt: chunk.retryAttempt || 0,
        maxAttempts: chunk.retryMaxAttempts || 0,
      })
      streamBuffersMap.set(bufferKey, parts)
      // streamTextMap unchanged — retry is not text
      // Clear error state -- no flash between attempts
      if (isActiveView) {
        useChatStore.setState({
          streamParts: parts,
          streamingContent: streamTextMap.get(bufferKey) ?? getTextFromParts(parts),
          error: null,
        })
      }
      break
    }

    case 'done': {
      const doneSettings = useSettingsStore.getState().settings
      if (doneSettings.notificationSounds === 'true' && chunk.stopReason !== 'aborted') {
        const event = mapToNotificationEvent(chunk.stopReason, chunk.resultSubtype)
        const config = getNotificationConfig(doneSettings)
        const eventConfig = config[event]
        if (eventConfig.sound) {
          if (event === 'success') {
            playCompletionSound()
          } else {
            playErrorSound()
          }
        }
        const doneDesktopMode = doneSettings.notificationDesktopMode ?? 'unfocused'
        if (eventConfig.desktop && shouldShowDesktopNotification(doneDesktopMode)) {
          window.agent.system.showNotification('Agent Desktop', getEventLabel(event)).catch(() => {})
        }
      }
      useChatStore.setState(cleanupStreamBuffer(store.activeConversationId, bufferKey))
      break
    }

    case 'error': {
      const errSettings = useSettingsStore.getState().settings
      if (errSettings.notificationSounds === 'true') {
        const config = getNotificationConfig(errSettings)
        const eventConfig = config.error_js
        if (eventConfig.sound) {
          playErrorSound()
        }
        const errDesktopMode = errSettings.notificationDesktopMode ?? 'unfocused'
        if (eventConfig.desktop && shouldShowDesktopNotification(errDesktopMode)) {
          window.agent.system.showNotification('Agent Desktop', getEventLabel('error_js')).catch(() => {})
        }
      }
      useChatStore.setState({
        error: chunk.content ?? 'Stream error',
        ...cleanupStreamBuffer(store.activeConversationId, bufferKey),
      })
      break
    }
  }
})
}
