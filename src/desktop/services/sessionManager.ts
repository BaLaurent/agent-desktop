// Ported from src/main/services/sessionManager.ts — the Claude Agent SDK persistent-session
// lifecycle. Electron-free; the only changes are import-path fixes (loadAgentSDK now imported
// straight from core; dropped the unused randomUUID + respondToApproval imports) and three
// harness-rule-mandated but behavior-identical rewrites: timer handles typed as `NodeJS.Timeout`
// (was `ReturnType<typeof setInterval>`), `new Promise(...)` → `Promise.withResolvers(...)`, and the
// redundant `session.query as { close(): void }` cast dropped (query already types close()).
import { loadAgentSDK } from '../../core/services/anthropic'
import { sendChunk, abortControllers, buildPromptWithHistory } from '../../core/services/streaming'
import { createCanUseTool } from '../../core/services/canUseTool'
import {
  forwardInitMcpStatus,
  forwardHookSystemMessage,
  forwardTaskNotification,
  type ChunkSender,
} from '../../core/services/sdkSystemForward'
import { buildQueryOptions } from './sessionManager/buildQueryOptions'
import { setupAuth } from './sessionManager/setupAuth'
import { configureMcp } from './sessionManager/configureMcp'
import { wireAbort } from './sessionManager/wireAbort'
import type { AISettings } from '../../core/services/streaming'
import type { ToolCall, ToolApprovalResponse, AskUserResponse } from '../../shared/types'
import { createLogger } from '../../core/utils/logger'

const log = createLogger('sessionManager')

// ─── Types ────────────────────────────────────────────────────

/** Token usage reported by the Claude Agent SDK on turn end */
export interface TurnUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  /** Context window size reported by the SDK via modelUsage[*].contextWindow */
  context_window?: number
}

/** Matches the return type of streamMessage for drop-in compatibility */
export interface TurnResult {
  content: string
  toolCalls: ToolCall[]
  aborted: boolean
  sessionId: string | null
  error?: string
  stopReason?: string
  usage?: TurnUsage
}

interface SDKUserMessage {
  type: 'user'
  message: { role: 'user'; content: string }
  parent_tool_use_id: null
  session_id: string
}

interface TurnState {
  content: string
  toolInputAccum: Map<string, string>
  toolCallsMap: Map<string, ToolCall>
  currentToolBlockId: string | null
  askUserToolIds: Set<string>
  /** True between a content_block_start(thinking) and its matching content_block_stop. */
  thinkingBlockActive: boolean
  lastStopReason?: string
  lastResultSubtype?: string
  /** Usage reported on the most recent SDK result message */
  lastUsage?: TurnUsage
  /** Number of background tasks still running */
  pendingTaskCount: number
  turnEndDeferred: boolean
  /** Polling interval (30s) — pushes synthetic prompt to check agent status */
  pollInterval: NodeJS.Timeout | null
  /** Length of turn.content when the last poll was sent — used to extract poll response */
  pollContentOffset: number
  resolve: (result: TurnResult) => void
  reject: (error: Error) => void
}

interface ActiveSession {
  query: { close(): void } & AsyncIterable<unknown>
  conversationId: number
  sessionId: string | null
  promptController: PromptController
  streamConsumer: Promise<void>
  currentTurn: TurnState | null
  status: 'active' | 'closed'
  lastActivity: number
  turnLock: Promise<void>
  turnLockRelease: (() => void) | null
  restoreEnv: (() => void) | null
  /** Deferred promise map for tool approval / ask-user responses */
  pendingRequests: Map<string, { resolve: (value: unknown) => void; conversationId: string | number | null }>
  pendingApprovalCount: number
  chunkBuffer: Array<{ type: string; content?: string; extra?: Record<string, string | number> }>
  /** Fingerprint of settings used to create this session — detect changes */
  settingsFingerprint: string
  /** Set to true when session is intentionally shutting down */
  closing: boolean
  /** Saved query options for SDK reconnection */
  queryOptions: Record<string, unknown>
  /** Timestamp of last message received from SDK iterable */
  lastMessageReceivedAt: number
}

// ─── PromptController (async iterable) ────────────────────────

export class PromptController {
  private queue: SDKUserMessage[] = []
  private waiter: { resolve: () => void } | null = null
  private closed = false

  push(msg: SDKUserMessage): void {
    if (this.closed) return
    this.queue.push(msg)
    if (this.waiter) {
      this.waiter.resolve()
      this.waiter = null
    }
  }

  close(): void {
    this.closed = true
    if (this.waiter) {
      this.waiter.resolve()
      this.waiter = null
    }
  }

  get isClosed(): boolean {
    return this.closed
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage, void> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!
        continue
      }
      if (this.closed) return
      // Wait for push() or close()
      const { promise, resolve } = Promise.withResolvers<void>()
      this.waiter = { resolve }
      await promise
    }
  }
}

// ─── Session Map ──────────────────────────────────────────────

const sessions = new Map<number, ActiveSession>()
const IDLE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const MAX_SESSIONS = 3

let idleTimer: NodeJS.Timeout | null = null

function startIdleTimer(): void {
  if (idleTimer) return
  idleTimer = setInterval(() => {
    const now = Date.now()
    for (const [convId, session] of sessions) {
      if (now - session.lastActivity > IDLE_TIMEOUT_MS && !session.currentTurn) {
        log.info('idle cleanup', { conversationId: convId })
        invalidateSession(convId)
      }
    }
  }, 60_000)
}

function stopIdleTimer(): void {
  if (idleTimer) {
    clearInterval(idleTimer)
    idleTimer = null
  }
}

// ─── Settings fingerprint ─────────────────────────────────────

function computeSettingsFingerprint(aiSettings: AISettings): string {
  // Only include settings that affect the SDK subprocess configuration
  return JSON.stringify({
    model: aiSettings.model,
    maxTurns: aiSettings.maxTurns,
    maxThinkingTokens: aiSettings.maxThinkingTokens,
    maxBudgetUsd: aiSettings.maxBudgetUsd,
    cwd: aiSettings.cwd,
    permissionMode: aiSettings.permissionMode,
    requirePlanApproval: aiSettings.requirePlanApproval,
    tools: aiSettings.tools,
    mcpServers: aiSettings.mcpServers ? Object.keys(aiSettings.mcpServers).sort() : [],
    cwdRestrictionEnabled: aiSettings.cwdRestrictionEnabled,
    skills: aiSettings.skills,
    skillsEnabled: aiSettings.skillsEnabled,
    apiKey: aiSettings.apiKey ? '***' : undefined,
    baseUrl: aiSettings.baseUrl,
  })
}

// ─── SDK message type guards ──────────────────────────────────

const TURN_END_SUBTYPES = new Set(['success', 'error_during_execution', 'error_max_turns', 'error_max_budget_usd', 'error_max_structured_output_retries'])

interface StreamEventMsg {
  type: 'stream_event'
  event?: {
    type?: string
    delta?: { type: string; text?: string; partial_json?: string; thinking?: string }
    content_block?: { type: string; name?: string; id?: string }
  }
}

interface ResultMsg {
  type: 'result'
  subtype?: string
  stop_reason?: string
  tool_name?: string
  tool_use_id?: string
  summary?: string
  content?: string
  usage?: TurnUsage
  modelUsage?: Record<string, { contextWindow?: number; maxOutputTokens?: number }>
}

interface SystemMsg {
  type: 'system'
  subtype?: string
  mcp_servers?: Array<{ name: string; status: string; error?: string }>
  hook_id?: string
  hook_name?: string
  hook_event?: string
  output?: string
  stdout?: string
  stderr?: string
  exit_code?: number
  outcome?: string
  // task lifecycle fields (task_started / task_progress / task_notification)
  task_id?: string
  tool_use_id?: string
  status?: string
  output_file?: string
  summary?: string
  description?: string
  last_tool_name?: string
}

type SDKMsg = StreamEventMsg | ResultMsg | SystemMsg | { type: string; session_id?: string }

// ─── Buffered send ────────────────────────────────────────────

function sendOrBuffer(
  session: ActiveSession,
  type: string,
  content?: string,
  extra?: Record<string, string | number>
): void {
  if (session.pendingApprovalCount > 0) {
    log.debug('buffering chunk', { type, pendingApprovalCount: session.pendingApprovalCount, bufferSize: session.chunkBuffer.length + 1, conversationId: session.conversationId })
    session.chunkBuffer.push({ type, content, extra })
  } else {
    sendChunk(type, content, extra)
  }
}

function flushBuffer(session: ActiveSession): void {
  if (session.chunkBuffer.length > 0) {
    log.debug('flushing buffered chunks', { count: session.chunkBuffer.length, conversationId: session.conversationId })
  }
  while (session.chunkBuffer.length > 0) {
    const chunk = session.chunkBuffer.shift()!
    sendChunk(chunk.type, chunk.content, chunk.extra)
  }
}

function denyPendingForSession(session: ActiveSession): void {
  for (const [id, entry] of session.pendingRequests) {
    entry.resolve({ behavior: 'deny', message: 'Session closed' } as ToolApprovalResponse)
    session.pendingRequests.delete(id)
  }
}

// ─── Stream consumer helpers ──────────────────────────────────

const MAX_EMPTY_EXITS = 3

/** Decide what to do after the SDK for-await loop exits cleanly. Returns shouldBreak=true when the consumer should stop (closing, no sessionId yet, deferred-with-pending-tasks orphan guard, or repeated empty exits). Otherwise mutates session.query with a new SDK query (resume = session.sessionId) and returns the updated empty-exit counter. The orphan guard exists because reconnect spawns a NEW SDK subprocess which won't see the old subprocess's still-running background agents — the safety-net timeout handles that case instead. */
async function reconnectOrBreak(
  session: ActiveSession,
  receivedAnyMessage: boolean,
  consecutiveEmptyExits: number,
): Promise<{ shouldBreak: boolean; consecutiveEmptyExits: number }> {
  if (session.closing) return { shouldBreak: true, consecutiveEmptyExits }
  if (!session.sessionId) return { shouldBreak: true, consecutiveEmptyExits }

  // If tasks are still pending, DON'T reconnect — the old subprocess had the agents.
  // A new subprocess (via reconnect) won't have them. The safety-net timeout will handle it.
  const pendingTurn = session.currentTurn
  if (pendingTurn && pendingTurn.pendingTaskCount > 0 && pendingTurn.turnEndDeferred) {
    log.info('SDK iterable ended with pending tasks — not reconnecting (would orphan agents)', { pendingTaskCount: pendingTurn.pendingTaskCount, conversationId: session.conversationId })
    return { shouldBreak: true, consecutiveEmptyExits }
  }

  let nextEmptyExits = consecutiveEmptyExits
  if (!receivedAnyMessage) {
    nextEmptyExits++
    if (nextEmptyExits >= MAX_EMPTY_EXITS) return { shouldBreak: true, consecutiveEmptyExits: nextEmptyExits }
  }

  // Reconnect with resume (only when no pending background tasks)
  log.info('SDK iterable ended, reconnecting', { conversationId: session.conversationId })
  const sdk = await loadAgentSDK()
  const abortController = new AbortController()
  abortControllers.set(session.conversationId, abortController)
  const newQuery = sdk.query({
    prompt: session.promptController,
    options: { ...session.queryOptions, resume: session.sessionId, abortController },
  })
  session.query = newQuery as unknown as ActiveSession['query']
  session.lastActivity = Date.now()
  session.lastMessageReceivedAt = Date.now()
  return { shouldBreak: false, consecutiveEmptyExits: nextEmptyExits }
}

/** Within-turn result dispatch: capture stop_reason/subtype/usage, handle tool_result (record output + emit tool_result chunk; AskUserQuestion id is consumed silently), and detect turn end. Turn end forks: pendingTaskCount > 0 + first time → defer + start 30s polling; deferred + poll response "fini" → force completion (resolve + currentTurn=null); else → emit done + resolve + currentTurn=null. */
function handleResultMessage(
  session: ActiveSession,
  turn: TurnState,
  result: ResultMsg,
  convExtra: Record<string, number>,
): void {
  if (result.stop_reason) turn.lastStopReason = result.stop_reason
  if (result.subtype) turn.lastResultSubtype = result.subtype
  if (result.usage) {
    turn.lastUsage = { ...result.usage }
    // Pull the authoritative context window size from modelUsage — the SDK
    // knows per-model limits (200k / 1M / whatever Anthropic ships next).
    if (result.modelUsage) {
      const entries = Object.values(result.modelUsage)
      const maxWindow = entries.reduce((m, e) => Math.max(m, e?.contextWindow ?? 0), 0)
      if (maxWindow > 0) turn.lastUsage.context_window = maxWindow
    }
  }

  if (result.subtype === 'tool_result' || result.tool_name) {
    // Tool result — NOT end of turn
    const toolName = result.tool_name || 'tool'
    const toolId = result.tool_use_id || `tool_${Date.now()}`

    if (turn.askUserToolIds.has(toolId)) {
      turn.askUserToolIds.delete(toolId)
    } else {
      const summary = result.summary || ''
      const fullOutput = result.content || summary
      const inputJson = turn.toolInputAccum.get(toolId) || '{}'
      const existing = turn.toolCallsMap.get(toolId)
      turn.toolCallsMap.set(toolId, {
        id: toolId,
        name: existing?.name || toolName,
        input: existing?.input || inputJson,
        output: fullOutput.slice(0, 50_000),
        status: 'done',
      })
      sendOrBuffer(session, 'tool_result', summary, {
        toolName,
        toolId,
        toolOutput: fullOutput.slice(0, 50_000),
        toolInput: inputJson,
        ...convExtra,
      })
    }
  }

  // Check for turn end
  if (result.subtype && TURN_END_SUBTYPES.has(result.subtype)) {
    log.debug('turn end', { subtype: result.subtype, pendingTasks: turn.pendingTaskCount, pendingApprovalCount: session.pendingApprovalCount, bufferSize: session.chunkBuffer.length, contentLen: turn.content.length, conversationId: session.conversationId })
    if (turn.pendingTaskCount > 0) {
      // Background tasks still running — defer done
      if (!turn.turnEndDeferred) {
        // First deferral: start polling every 30s
        turn.turnEndDeferred = true
        let pollCount = 0
        turn.pollInterval = setInterval(() => {
          pollCount++
          log.debug('poll: pushing status check prompt', { pollCount, pendingTaskCount: turn.pendingTaskCount, conversationId: session.conversationId })
          turn.pollContentOffset = turn.content.length
          session.promptController.push({
            type: 'user',
            message: { role: 'user', content: 'Use the TaskOutput tool to check if ALL your background agents have finished. If every agent is done, reply with ONLY the single word: fini — nothing else, no explanation. If any agent is still running, reply with ONLY: still running.' },
            parent_tool_use_id: null,
            session_id: session.sessionId || '',
          })
        }, 30_000)
        log.info('turn end deferred: background tasks pending, polling every 30s', { pendingTaskCount: turn.pendingTaskCount, conversationId: session.conversationId })
      } else {
        // Already deferred — poll prompt triggered this result/success
        const pollResponse = turn.content.slice(turn.pollContentOffset).trim().toLowerCase()
        if (pollResponse === 'fini') {
          // Claude confirmed all agents are done — force completion even if task_notification was missed
          log.info('poll response "fini" — forcing turn completion (pendingTasks may be stale)', { pendingTaskCount: turn.pendingTaskCount, conversationId: session.conversationId })
          if (turn.pollInterval) { clearInterval(turn.pollInterval); turn.pollInterval = null }
          sendChunk('done', undefined, {
            ...convExtra,
            ...(turn.lastStopReason ? { stopReason: turn.lastStopReason } : {}),
            ...(turn.lastResultSubtype ? { resultSubtype: turn.lastResultSubtype } : {}),
          })
          turn.resolve({
            content: turn.content,
            toolCalls: Array.from(turn.toolCallsMap.values()),
            aborted: false,
            sessionId: session.sessionId,
            stopReason: turn.lastStopReason,
            usage: turn.lastUsage,
          })
          session.currentTurn = null
          session.lastActivity = Date.now()
        } else {
          log.debug('turn end (poll response): still waiting', { pendingTaskCount: turn.pendingTaskCount, conversationId: session.conversationId })
        }
      }
    } else {
      // No pending tasks — send done (also cleans up any leftover poll from prior deferral)
      if (turn.pollInterval) { clearInterval(turn.pollInterval); turn.pollInterval = null }
      sendChunk('done', undefined, {
        ...convExtra,
        ...(turn.lastStopReason ? { stopReason: turn.lastStopReason } : {}),
        ...(turn.lastResultSubtype ? { resultSubtype: turn.lastResultSubtype } : {}),
      })
      turn.resolve({
        content: turn.content,
        toolCalls: Array.from(turn.toolCallsMap.values()),
        aborted: false,
        sessionId: session.sessionId,
        stopReason: turn.lastStopReason,
        usage: turn.lastUsage,
      })
      session.currentTurn = null
      session.lastActivity = Date.now()
    }
  }
}

/** Within-turn stream_event dispatch: tool_use start (emit tool_start, track AskUserQuestion specially), text_delta (append to turn.content + emit text), input_json_delta accumulation, content_block_stop (finalize tool input — early-detect background Task via run_in_background flag, emit tool_input). */
function handleStreamEvent(
  session: ActiveSession,
  turn: TurnState,
  msg: StreamEventMsg,
  convExtra: Record<string, number>,
): void {
  const event = msg.event
  if (
    event?.type === 'content_block_start' &&
    event.content_block?.type === 'tool_use'
  ) {
    const toolId = event.content_block.id || `tool_${Date.now()}`
    const toolName = event.content_block.name || 'tool'

    if (toolName === 'AskUserQuestion') {
      turn.askUserToolIds.add(toolId)
      turn.currentToolBlockId = toolId
      turn.toolInputAccum.set(toolId, '')
    } else {
      sendOrBuffer(session, 'tool_start', toolName, {
        toolName,
        toolId,
        ...convExtra,
      })
      turn.currentToolBlockId = toolId
      turn.toolInputAccum.set(toolId, '')
      turn.toolCallsMap.set(toolId, { id: toolId, name: toolName, input: '{}', output: '', status: 'done' })
    }
  } else if (
    event?.type === 'content_block_start' &&
    event.content_block?.type === 'thinking'
  ) {
    // Open a thinking block. Wrap its deltas in <thinking>…</thinking> inside
    // turn.content (persisted to messages.content) so the renderer can split
    // segments back out while preserving interleaved order.
    turn.thinkingBlockActive = true
    turn.content += '<thinking>'
  } else if (
    event?.type === 'content_block_delta' &&
    event.delta?.type === 'text_delta' &&
    event.delta.text
  ) {
    turn.content += event.delta.text
    sendOrBuffer(session, 'text', event.delta.text, convExtra)
  } else if (
    event?.type === 'content_block_delta' &&
    event.delta?.type === 'thinking_delta' &&
    event.delta.thinking
  ) {
    turn.content += event.delta.thinking
    sendOrBuffer(session, 'thinking', event.delta.thinking, convExtra)
  }

  if (
    event?.type === 'content_block_delta' &&
    event.delta?.type === 'input_json_delta'
  ) {
    if (turn.currentToolBlockId) {
      const existing = turn.toolInputAccum.get(turn.currentToolBlockId) || ''
      turn.toolInputAccum.set(turn.currentToolBlockId, existing + (event.delta.partial_json || ''))
    }
  }

  if (event?.type === 'content_block_stop') {
    if (turn.thinkingBlockActive) {
      turn.content += '</thinking>\n'
      turn.thinkingBlockActive = false
    }
  }

  if (event?.type === 'content_block_stop' && turn.currentToolBlockId && turn.toolInputAccum.has(turn.currentToolBlockId)) {
    if (turn.askUserToolIds.has(turn.currentToolBlockId)) {
      turn.currentToolBlockId = null
    } else {
      const inputJson = turn.toolInputAccum.get(turn.currentToolBlockId) || '{}'
      const existing = turn.toolCallsMap.get(turn.currentToolBlockId)
      if (existing) {
        turn.toolCallsMap.set(turn.currentToolBlockId, { ...existing, input: inputJson })
        // Early detection of background Task — task_started arrives AFTER turn end,
        // so we must count here (before result/success) using tool_use_id as key
        if (existing.name === 'Task') {
          try {
            const parsed = JSON.parse(inputJson)
            if (parsed.run_in_background) {
              turn.pendingTaskCount++
              log.debug('background task detected via tool input', { toolBlockId: turn.currentToolBlockId, pendingTaskCount: turn.pendingTaskCount, conversationId: session.conversationId })
            }
          } catch { /* ignore parse errors */ }
        }
      }
      sendOrBuffer(session, 'tool_input', undefined, {
        toolId: turn.currentToolBlockId,
        toolInput: inputJson,
        ...convExtra,
      })
      turn.currentToolBlockId = null
    }
  }
}

/** Within-turn system message dispatch: init/mcp_status, hook_response → system_message, task_started/progress logging, task_notification → emit chunk + decrement pendingTaskCount + push aggregation prompt when last task done. */
function handleSystemMessage(
  session: ActiveSession,
  turn: TurnState,
  sysMsg: SystemMsg,
  convExtra: Record<string, number>,
): void {
  // init/hook chunks are bufferable (they wait for pending approvals to clear)
  const bufferedSender: ChunkSender = (type, content, extra) =>
    sendOrBuffer(session, type, content, extra)

  if (sysMsg.subtype === 'init' && sysMsg.mcp_servers) {
    forwardInitMcpStatus(sysMsg, bufferedSender, convExtra, '[sessionManager]')
    return
  }
  if (sysMsg.subtype === 'hook_response') {
    forwardHookSystemMessage(sysMsg, bufferedSender, convExtra)
    return
  }
  if (sysMsg.subtype === 'task_started' && sysMsg.task_id) {
    log.debug('task_started', { taskId: sysMsg.task_id, description: sysMsg.description || '?', pendingTaskCount: turn.pendingTaskCount, conversationId: session.conversationId })
    return
  }
  if (sysMsg.subtype === 'task_progress' && sysMsg.task_id) {
    log.debug('task_progress', { taskId: sysMsg.task_id, lastToolName: sysMsg.last_tool_name || '?', pendingTaskCount: turn.pendingTaskCount, conversationId: session.conversationId })
    return
  }
  if (sysMsg.subtype === 'task_notification') {
    // Background task completed/failed/stopped — bypass approval buffer so
    // the user sees status updates even mid-approval.
    forwardTaskNotification(sysMsg, sendChunk, convExtra)

    // Simple decrement — no ID matching needed
    if (turn.pendingTaskCount > 0) turn.pendingTaskCount--
    log.debug('task_notification', { taskId: sysMsg.task_id, status: sysMsg.status, pendingTaskCount: turn.pendingTaskCount, conversationId: session.conversationId })

    if (turn.pendingTaskCount === 0 && turn.turnEndDeferred) {
      if (turn.pollInterval) { clearInterval(turn.pollInterval); turn.pollInterval = null }
      turn.turnEndDeferred = false
      log.info('all background tasks done — prompting agent to aggregate results', { conversationId: session.conversationId })
      // Push a prompt so the main agent can aggregate sub-agent results.
      // The turn stays open — the next result/success (with pendingTaskCount=0)
      // will send done via the normal path.
      session.promptController.push({
        type: 'user',
        message: { role: 'user', content: 'All your background agents have completed. Process their results and provide your final response.' },
        parent_tool_use_id: null,
        session_id: session.sessionId || '',
      })
    }
  }
}

/** Between-turn system message dispatch: ONLY task_notification is forwarded. All other subtypes (init, hook_response, task_started, task_progress) are silently dropped — they only make sense inside a turn. */
function handleBetweenTurnMessage(
  session: ActiveSession,
  msg: SDKMsg,
  convExtra: Record<string, number>,
): void {
  if (msg.type !== 'system') return
  const sysMsg = msg as SystemMsg
  if (sysMsg.subtype !== 'task_notification') return
  sendChunk('task_notification', sysMsg.summary, {
    ...convExtra,
    ...(sysMsg.task_id ? { taskId: sysMsg.task_id } : {}),
    ...(sysMsg.status ? { taskStatus: sysMsg.status } : {}),
    ...(sysMsg.output_file ? { outputFile: sysMsg.output_file } : {}),
  })
}

/** Capture tool_result outputs from synthetic SDK 'user' messages so the DB tool_calls column records OUTPUT, not just input. Without this, /context breakdown misses 10–100k of real context per tool-heavy turn. */
function handleUserMessage(turn: TurnState, msg: SDKMsg): void {
  // Tool results arrive as synthetic user messages between tool_use and the
  // next assistant chunk. The SDK delivers them as:
  //   { type: 'user', message: { role: 'user', content: [{type: 'tool_result', tool_use_id, content}, ...] } }
  // Without capturing `content` here, our DB's tool_calls column only ever
  // records tool INPUTS — outputs stay empty, which makes the /context
  // breakdown miss 10–100k of real context per tool-heavy turn and
  // inflates the derived "Tools & SDK overhead" bucket proportionally.
  //
  // The synthetic user-message shape is not modeled in SDKMsg (SDK-internal,
  // unexpressible here), so assert it to a named local before reading — never inline.
  const userMsg = msg as { type: 'user'; message?: { content?: unknown }; tool_use_result?: unknown }
  const blocks = Array.isArray(userMsg.message?.content) ? userMsg.message!.content as Array<Record<string, unknown>> : []
  for (const block of blocks) {
    if (block?.type !== 'tool_result') continue
    const toolUseId = block.tool_use_id as string | undefined
    if (!toolUseId) continue
    // content can be a string, an array of blocks, or missing — normalise to string
    let outputText = ''
    const c = block.content
    if (typeof c === 'string') outputText = c
    else if (Array.isArray(c)) {
      outputText = c.map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text
        }
        return JSON.stringify(part)
      }).join('\n')
    }
    const existing = turn.toolCallsMap.get(toolUseId)
    if (existing) {
      // Preserve anything already set, only fill output (cap 50k to match prior convention).
      turn.toolCallsMap.set(toolUseId, { ...existing, output: outputText.slice(0, 50_000) })
    } else {
      // Tool result arriving for an id we never saw a tool_use for — unusual; record for completeness.
      turn.toolCallsMap.set(toolUseId, {
        id: toolUseId,
        name: 'tool',
        input: '{}',
        output: outputText.slice(0, 50_000),
        status: 'done',
      })
    }
  }
}

/** Resolve the in-flight turn after the SDK iterable threw. Splits abort vs generic-error: both resolve (never reject) with partial content so callers can save what was already streamed. Clears poll interval and currentTurn. Caller must `break` afterwards. */
function finalizeStreamError(session: ActiveSession, err: unknown): void {
  const turn = session.currentTurn
  if (!turn) return
  if (turn.pollInterval) { clearInterval(turn.pollInterval); turn.pollInterval = null }
  if (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message.includes('abort'))
  ) {
    sendChunk('done', undefined, { conversationId: session.conversationId, stopReason: 'aborted' })
    turn.resolve({ content: turn.content, toolCalls: Array.from(turn.toolCallsMap.values()), aborted: true, sessionId: session.sessionId, stopReason: 'aborted', usage: turn.lastUsage })
  } else {
    const errorMsg = err instanceof Error ? err.message : 'Unknown streaming error'
    log.error('stream error', err)
    sendChunk('error', errorMsg, { conversationId: session.conversationId })
    // Resolve with partial content + error instead of rejecting — allows
    // streamAndSave to save whatever the AI already generated
    turn.resolve({
      content: turn.content,
      toolCalls: Array.from(turn.toolCallsMap.values()),
      aborted: false,
      sessionId: session.sessionId,
      error: errorMsg,
      stopReason: turn.lastStopReason,
      usage: turn.lastUsage,
    })
  }
  session.currentTurn = null
}

/** Post-while cleanup: deny pending approvals, drop env, evict from map. No-op if already cleaned by invalidateSession. */
function cleanupClosedSession(session: ActiveSession): void {
  if (sessions.has(session.conversationId) && session.status !== 'closed') {
    session.status = 'closed'
    denyPendingForSession(session)
    session.restoreEnv?.()
    sessions.delete(session.conversationId)
    abortControllers.delete(session.conversationId)
    if (session.turnLockRelease) {
      session.turnLockRelease()
      session.turnLockRelease = null
    }
  }
}

// ─── Stream consumer ──────────────────────────────────────────

/** Dispatch a single SDK message to the appropriate handler. Captures session_id lazily on first sighting; routes between-turn messages (turn === null) to the narrow filter, otherwise dispatches by msg.type to per-type handlers. */
function dispatchMessage(
  session: ActiveSession,
  msg: SDKMsg,
  convExtra: Record<string, number>,
): void {
  // Capture session_id from any message (narrow with `in`/`typeof` so the read stays checked)
  if (!session.sessionId && 'session_id' in msg && typeof msg.session_id === 'string') {
    session.sessionId = msg.session_id
  }

  const turn = session.currentTurn
  if (!turn) {
    handleBetweenTurnMessage(session, msg, convExtra)
    return
  }

  // Within a turn: process messages by type
  if (msg.type === 'stream_event') {
    handleStreamEvent(session, turn, msg as StreamEventMsg, convExtra)
  } else if (msg.type === 'result') {
    handleResultMessage(session, turn, msg as ResultMsg, convExtra)
  } else if (msg.type === 'user') {
    handleUserMessage(turn, msg)
  } else if (msg.type === 'system') {
    handleSystemMessage(session, turn, msg as SystemMsg, convExtra)
  }
}

async function consumeStream(session: ActiveSession): Promise<void> {
  const convExtra: Record<string, number> = { conversationId: session.conversationId }
  let consecutiveEmptyExits = 0

  while (!session.closing) {
    let receivedAnyMessage = false
    try {
      for await (const message of session.query) {
        receivedAnyMessage = true
        consecutiveEmptyExits = 0
        session.lastMessageReceivedAt = Date.now()
        dispatchMessage(session, message as SDKMsg, convExtra)
      }
      const next = await reconnectOrBreak(session, receivedAnyMessage, consecutiveEmptyExits)
      consecutiveEmptyExits = next.consecutiveEmptyExits
      if (next.shouldBreak) break
    } catch (err: unknown) {
      // Query threw (subprocess crash, abort, etc.)
      finalizeStreamError(session, err)
      break
    }
  }

  cleanupClosedSession(session)
}

// ─── Session creation ─────────────────────────────────────────

/** Wire canUseTool into queryOptions. Delegated to the core factory so streaming and sessionManager share one source of truth. */
function wireCanUseTool(
  session: ActiveSession,
  queryOptions: Record<string, unknown>,
  aiSettings: AISettings,
  permMode: string,
  conversationId: number,
): void {
  const sessionCanUseTool = createCanUseTool({
    aiSettings: {
      requirePlanApproval: aiSettings?.requirePlanApproval,
      disabledSkills: aiSettings?.disabledSkills,
    },
    permissionMode: permMode,
    chunkConversationId: conversationId,
    pendingRequestsKey: conversationId,
    pendingRequests: session.pendingRequests,
    sendChunk,
    onApprovalStart: () => { session.pendingApprovalCount++ },
    onApprovalEnd: () => {
      session.pendingApprovalCount--
      if (session.pendingApprovalCount === 0) flushBuffer(session)
    },
  })
  queryOptions.canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    log.debug('canUseTool called', { toolName, permMode, pendingApprovalCount: session.pendingApprovalCount, conversationId })
    return sessionCanUseTool(toolName, input)
  }
}

/** Push the initial prompt into the controller. When resuming, send only the last user message — SDK already has prior history. */
function pushInitialPrompt(
  promptController: PromptController,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  sdkSessionId: string | null,
): void {
  const initialPrompt = sdkSessionId
    ? messages[messages.length - 1]?.content ?? ''
    : buildPromptWithHistory(messages)
  promptController.push({
    type: 'user',
    message: { role: 'user', content: initialPrompt },
    parent_tool_use_id: null,
    session_id: '',
  })
}

/** LRU-evict oldest idle session when MAX_SESSIONS exceeded. Skips the just-created session and any session with an in-flight turn. */
function evictOldestIfOverLimit(currentConvId: number): void {
  if (sessions.size <= MAX_SESSIONS) return
  let oldestConvId: number | null = null
  let oldestActivity = Infinity
  for (const [cid, s] of sessions) {
    if (!s.currentTurn && s.lastActivity < oldestActivity && cid !== currentConvId) {
      oldestConvId = cid
      oldestActivity = s.lastActivity
    }
  }
  if (oldestConvId !== null) {
    log.info('LRU eviction', { conversationId: oldestConvId })
    invalidateSession(oldestConvId)
  }
}

async function createSession(
  conversationId: number,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string | undefined,
  aiSettings: AISettings,
  sdkSessionId: string | null
): Promise<ActiveSession> {
  const restoreEnv = await setupAuth(aiSettings)
  const sdk = await loadAgentSDK()
  const promptController = new PromptController()

  const { queryOptions, permMode } = buildQueryOptions({ systemPrompt, aiSettings, sdkSessionId })

  const session: ActiveSession = {
    query: null as unknown as ActiveSession['query'],
    conversationId,
    sessionId: null,
    promptController,
    streamConsumer: null as unknown as Promise<void>,
    currentTurn: null,
    status: 'active',
    lastActivity: Date.now(),
    turnLock: Promise.resolve(),
    turnLockRelease: null,
    restoreEnv,
    pendingRequests: new Map(),
    pendingApprovalCount: 0,
    chunkBuffer: [],
    settingsFingerprint: computeSettingsFingerprint(aiSettings),
    closing: false,
    queryOptions: {},
    lastMessageReceivedAt: Date.now(),
  }

  wireCanUseTool(session, queryOptions, aiSettings, permMode, conversationId)
  configureMcp(queryOptions, aiSettings)
  pushInitialPrompt(promptController, messages, sdkSessionId)
  wireAbort(conversationId, queryOptions)

  // Save queryOptions for reconnection (abortController excluded — recreated each time)
  session.queryOptions = { ...queryOptions }
  delete session.queryOptions.abortController

  session.query = sdk.query({ prompt: promptController, options: queryOptions }) as unknown as ActiveSession['query']
  session.streamConsumer = consumeStream(session)

  sessions.set(conversationId, session)
  startIdleTimer()
  evictOldestIfOverLimit(conversationId)

  return session
}

// ─── Public API ───────────────────────────────────────────────

export async function sendTurn(
  conversationId: number,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string | undefined,
  aiSettings: AISettings,
  sdkSessionId: string | null
): Promise<TurnResult> {
  let session = sessions.get(conversationId)

  // Invalidate if settings changed
  if (session && session.status === 'active') {
    const newFingerprint = computeSettingsFingerprint(aiSettings)
    if (newFingerprint !== session.settingsFingerprint) {
      log.info('settings changed, invalidating session', { conversationId })
      invalidateSession(conversationId)
      session = undefined
    }
  }

  // Invalidate if DB session was cleared (clear/compact/regenerate/edit)
  if (session && session.status === 'active' && sdkSessionId === null) {
    log.info('SDK session cleared in DB, invalidating in-memory session', { conversationId })
    invalidateSession(conversationId)
    session = undefined
  }

  // Invalidate if session was closed
  if (session && session.status === 'closed') {
    sessions.delete(conversationId)
    session = undefined
  }

  if (!session) {
    // Create new session — initial message already pushed via promptController
    session = await createSession(conversationId, messages, systemPrompt, aiSettings, sdkSessionId)
  } else {
    // Existing session — wait for any in-flight turn to complete
    await session.turnLock

    // Push new message
    const lastMessage = messages[messages.length - 1]
    if (lastMessage) {
      session.promptController.push({
        type: 'user',
        message: { role: 'user', content: lastMessage.content },
        parent_tool_use_id: null,
        session_id: session.sessionId || '',
      })
    }
  }

  // Set up turn lock
  const turnLockDeferred = Promise.withResolvers<void>()
  session.turnLock = turnLockDeferred.promise
  session.turnLockRelease = turnLockDeferred.resolve

  // Send initial 'text' chunk to signal stream start
  sendChunk('text', '', { conversationId })

  // Create deferred promise for this turn
  const { promise: turnPromise, resolve: turnResolve, reject: turnReject } = Promise.withResolvers<TurnResult>()
  session.currentTurn = {
    content: '',
    toolInputAccum: new Map(),
    toolCallsMap: new Map(),
    currentToolBlockId: null,
    askUserToolIds: new Set(),
    thinkingBlockActive: false,
    pendingTaskCount: 0,
    turnEndDeferred: false,
    pollInterval: null,
    pollContentOffset: 0,
    resolve: turnResolve,
    reject: turnReject,
  }
  const turnResult = await turnPromise

  // Release turn lock
  if (session.turnLockRelease) {
    session.turnLockRelease()
    session.turnLockRelease = null
  }

  return turnResult
}

export function invalidateSession(conversationId: number): void {
  const session = sessions.get(conversationId)
  if (!session) return

  session.closing = true
  session.promptController.close()
  try { session.query.close() } catch { /* already closed */ }
  denyPendingForSession(session)
  session.status = 'closed'
  sessions.delete(conversationId)
  abortControllers.delete(conversationId)
  session.restoreEnv?.()

  // Reject any pending turn
  if (session.currentTurn) {
    if (session.currentTurn.pollInterval) {
      clearInterval(session.currentTurn.pollInterval)
      session.currentTurn.pollInterval = null
    }
    session.currentTurn.resolve({
      content: session.currentTurn.content,
      toolCalls: Array.from(session.currentTurn.toolCallsMap.values()),
      aborted: true,
      sessionId: session.sessionId,
      usage: session.currentTurn.lastUsage,
    })
    session.currentTurn = null
  }

  // Release turn lock
  if (session.turnLockRelease) {
    session.turnLockRelease()
    session.turnLockRelease = null
  }

  log.info('session invalidated', { conversationId })
}

export function abortSession(conversationId: number): void {
  const session = sessions.get(conversationId)
  if (!session) return

  session.closing = true
  // Abort the underlying AbortController — the consumer will catch and clean up
  const controller = abortControllers.get(conversationId)
  if (controller) {
    controller.abort()
  }
  // Also close promptController to ensure clean teardown
  session.promptController.close()
}

export function shutdownAllSessions(): void {
  for (const [convId] of sessions) {
    invalidateSession(convId)
  }
  stopIdleTimer()
}

export function getSession(conversationId: number): { status: string; sessionId: string | null; hasTurn: boolean } | null {
  const session = sessions.get(conversationId)
  if (!session) return null
  return {
    status: session.status,
    sessionId: session.sessionId,
    hasTurn: session.currentTurn !== null,
  }
}

export function hasActiveSession(conversationId: number): boolean {
  const session = sessions.get(conversationId)
  return session != null && session.status === 'active'
}

/**
 * Hook into the existing respondToApproval for session-based pending requests.
 * Called from streaming.ts respondToApproval when the request isn't found in the one-shot map.
 */
export function respondToSessionApproval(requestId: string, response: ToolApprovalResponse | AskUserResponse): boolean {
  for (const session of sessions.values()) {
    const pending = session.pendingRequests.get(requestId)
    if (pending) {
      pending.resolve(response)
      session.pendingRequests.delete(requestId)
      return true
    }
  }
  return false
}
