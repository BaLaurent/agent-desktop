import { create } from 'zustand'
import type { Message, Attachment, StreamChunk, StreamPart, AskUserQuestion, McpConnectionStatus, NotificationEvent, NotificationConfig } from '../../shared/types'
import { DEFAULT_NOTIFICATION_CONFIG, NOTIFICATION_EVENTS, WS_DISCONNECTED_MESSAGE } from '../../shared/constants'
import { useSettingsStore } from './settingsStore'
import { playCompletionSound, playErrorSound } from '../utils/notificationSound'
import type { ContextBreakdown } from '../../core/services/contextBreakdown'
import { createLogger } from '../../core/utils/logger'

const log = createLogger('chatStore')

export interface QueuedMessage {
  id: string
  content: string
  attachments?: Attachment[]
  createdAt: number
}

/** Transient state shown when the user invokes /context. Auto-dismisses. */
export interface ContextDisplay {
  breakdown: ContextBreakdown
  shownAt: number
  /** omp-backend-only: session cost + message counts (null for the Claude backend). */
  piStats?: { cost: number; totalMessages: number; toolCalls: number } | null
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
  /**
   * Web transport state. 'reconnecting' is set when a streaming RPC rejects
   * mid-flight with a WebSocket drop: the server keeps streaming and persists
   * the turn, so instead of a fatal error we keep the streaming view and wait
   * for the shim to reconnect and reload authoritative state. Always
   * 'connected' under Electron (its IPC bridge never drops).
   */
  connectionStatus: 'connected' | 'reconnecting'
  activeConversationId: number | null
  messageQueues: Record<number, QueuedMessage[]>
  queuePaused: Record<number, boolean>
  queueEditLocked: Record<number, boolean>
  taskNotifications: Record<number, TaskNotification[]>
  contextDisplay: ContextDisplay | null
  /**
   * PI-only: pending plan-approval request per conversation. Emitted by the
   * agent-desktop-parity extension when the agent calls exit_plan_mode.
   * Persists across turn boundaries (unlike streamParts) so the approval
   * UI stays visible after the agent's turn ends — until the user clicks.
   */
  pendingPlanApprovals: Record<number, { plan: string } | undefined>

  loadMessages: (conversationId: number) => Promise<void>
  sendMessage: (conversationId: number, content: string, attachments?: Attachment[]) => Promise<void>
  stopGeneration: () => Promise<void>
  regenerateLastResponse: (conversationId: number) => Promise<void>
  editMessage: (messageId: number, content: string) => Promise<void>
  setActiveConversation: (id: number | null) => void
  clearChat: () => void
  clearContext: (conversationId: number) => Promise<void>
  compactContext: (conversationId: number) => Promise<void>
  showContextInfo: (conversationId: number) => Promise<void>
  dismissContextInfo: () => void
  addToQueue: (conversationId: number, content: string, attachments?: Attachment[]) => void
  removeFromQueue: (conversationId: number, messageId: string) => void
  editQueuedMessage: (conversationId: number, messageId: string, newContent: string) => void
  reorderQueue: (conversationId: number, fromIndex: number, toIndex: number) => void
  clearQueue: (conversationId: number) => void
  pauseQueue: (conversationId: number) => void
  resumeQueue: (conversationId: number) => void
  lockQueueForEdit: (conversationId: number) => void
  unlockQueueForEdit: (conversationId: number) => void
  /**
   * Dismiss the PI plan-approval UI for a conversation. Called by
   * PlanApprovalBlock after the user clicks Approve or Reject.
   */
  clearPendingPlanApproval: (conversationId: number) => void
}

// --- Module-level stream buffer map (non-reactive) ---
// Only the active conversation's streamParts/streamingContent are in Zustand state.
// Background conversation buffers live here and never trigger renders.
const streamBuffersMap = new Map<number, StreamPart[]>()

/** Accumulated text content per conversation — avoids O(n) recomputation on every chunk */
const streamTextMap = new Map<number, string>()

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

/** Process a queued message: handle slash commands (/clear, /compact, /context) and macros, or send normally */
async function processQueuedMessage(
  get: () => ChatState,
  conversationId: number,
  content: string,
  attachments?: Attachment[]
): Promise<void> {
  const trimmed = content.trim()

  // Client-side slash commands -- don't start a stream, so must continue drain
  if (trimmed === '/clear' || trimmed === '/compact' || trimmed === '/context') {
    if (trimmed === '/clear') {
      await get().clearContext(conversationId)
    } else if (trimmed === '/compact') {
      await get().compactContext(conversationId)
    } else {
      get().showContextInfo(conversationId)
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
    // A WebSocket drop mid-stream (web mode only) is recoverable, not fatal:
    // the server is not aborted, keeps streaming, and persists the turn. Keep
    // the streaming view and flag 'reconnecting' — the onReconnect listener
    // reloads the authoritative DB state once the shim reconnects. Crucially
    // we do NOT clear the buffer, surface an error, or pause the queue here.
    if (msg === WS_DISCONNECTED_MESSAGE && streamBuffersMap.has(conversationId)) {
      set({ connectionStatus: 'reconnecting' })
      return
    }
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
  connectionStatus: 'connected',
  activeConversationId: null,
  messageQueues: {},
  queuePaused: {},
  queueEditLocked: {},
  taskNotifications: {},
  contextDisplay: null,
  pendingPlanApprovals: {},

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
      tool_calls: null,
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
      ...(id !== prevId ? { messages: [], clearedAt: null, compactSummary: null, contextDisplay: null } : {}),
      ...syncViewFromBuffer(id),
    })
  },

  clearChat: () => {
    streamBuffersMap.clear()
    streamTextMap.clear()
    set({ messages: [], clearedAt: null, compactSummary: null, isCompacting: false, streamParts: [], streamingContent: '', isStreaming: false, error: null, activeConversationId: null, contextDisplay: null })
  },

  clearContext: async (conversationId: number) => {
    const clearedAt = new Date().toISOString()
    await window.agent.conversations.update(conversationId, { cleared_at: clearedAt, compact_summary: null, pi_session_file: null } as any)
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

  showContextInfo: async (conversationId: number) => {
    try {
      const breakdown = await window.agent.context.getBreakdown(conversationId) as ContextBreakdown
      const shownAt = Date.now()
      // omp-backed conversations carry a pi_session_file → sessionStats returns
      // cost + message counts; Claude conversations return {stats:null} with no
      // spawn (the handler early-returns when no session file exists).
      let piStats: ContextDisplay['piStats'] = null
      try {
        const res = await window.agent.pi.sessionStats(conversationId)
        if (res.stats) {
          piStats = { cost: res.stats.cost, totalMessages: res.stats.totalMessages, toolCalls: res.stats.toolCalls }
        }
      } catch {
        // stats are best-effort — never block the /context bubble
      }
      set({ contextDisplay: { breakdown, shownAt, piStats } })
      // Auto-dismiss after 20s only if the same bubble is still visible
      setTimeout(() => {
        if (useChatStore.getState().contextDisplay?.shownAt === shownAt) {
          useChatStore.setState({ contextDisplay: null })
        }
      }, 20_000)
    } catch (err) {
      log.error('showContextInfo failed', err)
    }
  },

  dismissContextInfo: () => set({ contextDisplay: null }),

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

  clearPendingPlanApproval: (conversationId) => {
    const { [conversationId]: _, ...rest } = get().pendingPlanApprovals
    set({ pendingPlanApprovals: rest })
  },
}))

// Expose streamBuffersMap for tests and external checks (e.g. conversation-updated listener)
// consumed by chatStore.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
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

// Reconnect listener -- web shim only (no-op under Electron). A WS drop
// mid-stream is surfaced as 'reconnecting' (see streamOperation), not a fatal
// error. On reconnect, pull the authoritative DB state: any assistant turn the
// server persisted during the offline window re-appears, and the streaming
// flag is reconciled from it. Stream chunks/conversationUpdated events emitted
// while we were offline were lost (fire-and-forget broadcast), so this reload
// is the recovery path.
if (typeof window !== 'undefined' && window.agent?.events?.onReconnect) {
  window.agent.events.onReconnect(() => {
    const convId = useChatStore.getState().activeConversationId
    if (convId == null) {
      useChatStore.setState({ connectionStatus: 'connected' })
      return
    }
    // Drop the stale buffer so loadMessages' DB state is authoritative and the
    // conversationUpdated / ensureBuffer guards (!streamBuffersMap.has) re-arm.
    streamBuffersMap.delete(convId)
    streamTextMap.delete(convId)
    void useChatStore.getState().loadMessages(convId).then(() => {
      // A chunk may have arrived during the load gap, recreating the buffer via
      // ensureBuffer for a resuming/new turn. If so, that turn now owns the
      // streaming view — don't reconcile against the reloaded (older) messages,
      // which would wrongly wipe its live buffer.
      if (streamBuffersMap.has(convId)) {
        useChatStore.setState({ connectionStatus: 'connected' })
        return
      }
      const msgs = useChatStore.getState().messages
      // Last message is the assistant reply ⇒ the server finished + persisted
      // the turn during the gap ⇒ streaming is done. Otherwise the turn is
      // still running server-side; resuming chunks re-arm isStreaming via
      // ensureBuffer, so leave the streaming view in place.
      const turnComplete = msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant'
      useChatStore.setState(turnComplete
        ? { connectionStatus: 'connected', ...cleanupStreamBuffer(convId, convId) }
        : { connectionStatus: 'connected' }
      )
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream chunk handlers — table-dispatched from the listener below.
// Each handler receives the raw chunk + a ListenerCtx captured ONCE per chunk.
// ─────────────────────────────────────────────────────────────────────────────

interface ListenerCtx {
  /** Snapshot taken at listener entry — do NOT re-read inside handlers. */
  store: ChatState
  bufferKey: number
  isActiveView: boolean
}

type ChunkHandler = (chunk: StreamChunk, ctx: ListenerCtx) => void

/** Update module-level buffer and (when active view) sync the reactive state. */
function commitParts(ctx: ListenerCtx, parts: StreamPart[], textContent?: string): void {
  const { bufferKey, isActiveView } = ctx
  streamBuffersMap.set(bufferKey, parts)
  const text = textContent ?? (streamTextMap.get(bufferKey) ?? getTextFromParts(parts))
  streamTextMap.set(bufferKey, text)
  if (isActiveView) {
    useChatStore.setState({ streamParts: parts, streamingContent: text })
  }
}

function safeParseJSON<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined
  try { return JSON.parse(raw) as T } catch { return undefined }
}

function handleText(chunk: StreamChunk, ctx: ListenerCtx): void {
  if (!chunk.content) return
  const { bufferKey } = ctx
  const parts = [...(streamBuffersMap.get(bufferKey) || [])]
  const lastPart = parts[parts.length - 1]
  if (lastPart && lastPart.type === 'text') {
    parts[parts.length - 1] = { type: 'text', content: lastPart.content + chunk.content }
  } else {
    parts.push({ type: 'text', content: chunk.content })
  }
  // Task 1.3: Incremental text accumulation instead of filter+map+join
  const prevText = streamTextMap.get(bufferKey) ?? ''
  commitParts(ctx, parts, prevText + chunk.content)
}

function handleThinking(chunk: StreamChunk, ctx: ListenerCtx): void {
  if (!chunk.content) return
  const { bufferKey } = ctx
  const parts = [...(streamBuffersMap.get(bufferKey) || [])]
  const lastPart = parts[parts.length - 1]
  if (lastPart && lastPart.type === 'thinking') {
    parts[parts.length - 1] = { type: 'thinking', content: lastPart.content + chunk.content }
  } else {
    parts.push({ type: 'thinking', content: chunk.content })
  }
  // streamingContent (= text-only) is unchanged — thinking lives in streamParts only.
  commitParts(ctx, parts)
}

function handleToolStart(chunk: StreamChunk, ctx: ListenerCtx): void {
  const parts = [...(streamBuffersMap.get(ctx.bufferKey) || [])]
  const toolName = chunk.toolName || chunk.content || 'tool'
  const toolId = chunk.toolId || `tool_${Date.now()}`
  parts.push({ type: 'tool', name: toolName, id: toolId, status: 'running' })
  commitParts(ctx, parts)
}

function handleToolInput(chunk: StreamChunk, ctx: ListenerCtx): void {
  const parts = [...(streamBuffersMap.get(ctx.bufferKey) || [])]
  const toolId = chunk.toolId
  const toolInput = safeParseJSON<Record<string, unknown>>(chunk.toolInput) ?? {}
  // Find the running tool and add input
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p.type === 'tool' && p.status === 'running' && (!toolId || p.id === toolId)) {
      parts[i] = { ...p, input: toolInput }
      break
    }
  }
  commitParts(ctx, parts)
}

function dispatchBashResult(input: Record<string, unknown> | undefined): void {
  if (typeof input?.command !== 'string') return
  window.dispatchEvent(new CustomEvent('agent:bash-tool-result', {
    detail: { command: input.command },
  }))
}

/** Mutates `parts` in-place to mark the matching running tool as done.
 *  Returns true if a matching tool was found, false otherwise. */
function finalizeRunningTool(parts: StreamPart[], chunk: StreamChunk): boolean {
  const toolId = chunk.toolId
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p.type !== 'tool' || p.status !== 'running') continue
    if (toolId && p.id !== toolId) continue
    const done = {
      ...p,
      status: 'done' as const,
      summary: chunk.content || '',
      output: chunk.toolOutput || chunk.content || '',
    }
    parts[i] = done
    // If input was sent with the result chunk, set it too
    if (chunk.toolInput && !p.input) {
      const parsed = safeParseJSON<Record<string, unknown>>(chunk.toolInput)
      if (parsed) parts[i] = { ...done, input: parsed }
    }
    // Dispatch after Bash has actually finished so git state is up-to-date
    const resolvedInput = (parts[i] as { input?: Record<string, unknown> }).input
    if (p.name === 'Bash') dispatchBashResult(resolvedInput)
    return true
  }
  return false
}

/** Append a standalone tool_result entry when no matching running tool was found. */
function appendStandaloneToolResult(parts: StreamPart[], chunk: StreamChunk): void {
  const toolInput = safeParseJSON<Record<string, unknown>>(chunk.toolInput)
  parts.push({
    type: 'tool',
    name: chunk.toolName || 'tool',
    id: chunk.toolId || `tool_${Date.now()}`,
    status: 'done',
    summary: chunk.content || '',
    output: chunk.toolOutput || chunk.content || '',
    input: toolInput,
  })
  // Dispatch for untracked Bash results too
  if (chunk.toolName === 'Bash') dispatchBashResult(toolInput)
}

function handleToolResult(chunk: StreamChunk, ctx: ListenerCtx): void {
  const parts = [...(streamBuffersMap.get(ctx.bufferKey) || [])]
  if (!finalizeRunningTool(parts, chunk)) {
    appendStandaloneToolResult(parts, chunk)
  }
  commitParts(ctx, parts)
}

function handleToolApproval(chunk: StreamChunk, ctx: ListenerCtx): void {
  if (!chunk.requestId || !chunk.toolName) return
  const parts = [...(streamBuffersMap.get(ctx.bufferKey) || [])]
  const toolInput = safeParseJSON<Record<string, unknown>>(chunk.toolInput) ?? {}
  parts.push({ type: 'tool_approval', requestId: chunk.requestId, toolName: chunk.toolName, toolInput })
  commitParts(ctx, parts)
}

function handleAskUser(chunk: StreamChunk, ctx: ListenerCtx): void {
  if (!chunk.requestId || !chunk.questions) return
  const parts = [...(streamBuffersMap.get(ctx.bufferKey) || [])]
  const questions = safeParseJSON<AskUserQuestion[]>(chunk.questions) ?? []
  parts.push({ type: 'ask_user', requestId: chunk.requestId, questions })
  commitParts(ctx, parts)
}

// PI-specific: emitted by the bundled agent-desktop-parity extension
// when the agent calls exit_plan_mode(plan). We store in TWO places:
//   (1) streamParts buffer — renders inline during streaming.
//   (2) pendingPlanApprovals state — persists across 'done' so the
//       approval UI stays visible after the agent's turn ends.
function handlePlanApprovalRequest(chunk: StreamChunk, ctx: ListenerCtx): void {
  if (!chunk.content || chunk.conversationId == null) return
  const parts = [...(streamBuffersMap.get(ctx.bufferKey) || [])]
  parts.push({ type: 'plan_approval_request', conversationId: chunk.conversationId, plan: chunk.content })
  commitParts(ctx, parts)
  const existing = useChatStore.getState().pendingPlanApprovals
  useChatStore.setState({
    pendingPlanApprovals: { ...existing, [chunk.conversationId]: { plan: chunk.content } },
  })
}

function handleMcpStatus(chunk: StreamChunk, ctx: ListenerCtx): void {
  if (!chunk.mcpServers) return
  const servers = safeParseJSON<McpConnectionStatus[]>(chunk.mcpServers) ?? []
  if (servers.length === 0) return
  const parts = [...(streamBuffersMap.get(ctx.bufferKey) || [])]
  parts.push({ type: 'mcp_status', servers })
  commitParts(ctx, parts)
}

function handleSystemMessage(chunk: StreamChunk, ctx: ListenerCtx): void {
  if (!chunk.content) return
  const parts = [...(streamBuffersMap.get(ctx.bufferKey) || [])]
  parts.push({
    type: 'system_message',
    content: chunk.content,
    hookName: chunk.hookName,
    hookEvent: chunk.hookEvent,
  })
  commitParts(ctx, parts)
}

function handleRetry(chunk: StreamChunk, ctx: ListenerCtx): void {
  const { bufferKey, isActiveView } = ctx
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
}

function handleDone(chunk: StreamChunk, ctx: ListenerCtx): void {
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
  useChatStore.setState(cleanupStreamBuffer(ctx.store.activeConversationId, ctx.bufferKey))
}

function handleError(chunk: StreamChunk, ctx: ListenerCtx): void {
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
  // Delete buffer maps (stop accumulating) but keep streamParts/streamingContent
  // in state — the partial response stays visible instead of flashing away.
  // The backend saves partial content to DB; conversationUpdated will reload messages.
  streamBuffersMap.delete(ctx.bufferKey)
  streamTextMap.delete(ctx.bufferKey)
  const activeId = ctx.store.activeConversationId
  const isStillStreaming = activeId != null && streamBuffersMap.has(activeId)
  useChatStore.setState({
    error: chunk.content ?? 'Stream error',
    isStreaming: isStillStreaming,
  })
}

const chunkHandlers: Partial<Record<StreamChunk['type'], ChunkHandler>> = {
  text: handleText,
  thinking: handleThinking,
  tool_start: handleToolStart,
  tool_input: handleToolInput,
  tool_result: handleToolResult,
  tool_approval: handleToolApproval,
  ask_user: handleAskUser,
  plan_approval_request: handlePlanApprovalRequest,
  mcp_status: handleMcpStatus,
  system_message: handleSystemMessage,
  retry: handleRetry,
  done: handleDone,
  error: handleError,
}

/**
 * `task_notification` is special: it can arrive between turns with NO active
 * stream buffer — handled before the buffer guard so it's never dropped.
 * Also fires sound + desktop notification.
 */
function handleTaskNotification(chunk: StreamChunk, store: ChatState, fallbackBufferKey: number | null): void {
  const convId = fallbackBufferKey ?? store.activeConversationId
  if (convId == null) return
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

/**
 * Auto-create stream buffer for streams initiated elsewhere (mobile/web client).
 * Skip terminal events (done/error) — the initial empty text chunk sent before
 * every stream (streaming.ts:254, sessionManager.ts:874) handles buffer creation.
 * Returns true if the chunk should be processed, false if it must be dropped.
 */
function ensureBuffer(chunk: StreamChunk, bufferKey: number, store: ChatState): boolean {
  if (streamBuffersMap.has(bufferKey)) return true
  if (chunk.type === 'done' || chunk.type === 'error') return false
  streamBuffersMap.set(bufferKey, [])
  streamTextMap.set(bufferKey, '')
  if (bufferKey === store.activeConversationId) {
    useChatStore.setState({ isStreaming: true, streamParts: [], streamingContent: '' })
    // Reload messages to show the user message that triggered this stream
    store.loadMessages(bufferKey)
  }
  return true
}

// Stream listener -- guarded against preload not being ready
if (typeof window !== 'undefined' && window.agent?.messages?.onStream) {
  window.agent.messages.onStream((chunk: StreamChunk) => {
    const store = useChatStore.getState()
    const bufferKey = chunk.conversationId ?? store.activeConversationId
    // task_notification can arrive between turns (no active stream buffer)
    if (chunk.type === 'task_notification') {
      handleTaskNotification(chunk, store, bufferKey)
      return
    }
    if (bufferKey == null) return
    if (!ensureBuffer(chunk, bufferKey, store)) return
    const ctx: ListenerCtx = { store, bufferKey, isActiveView: bufferKey === store.activeConversationId }
    chunkHandlers[chunk.type]?.(chunk, ctx)
  })
}
