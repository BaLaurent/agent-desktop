import { randomUUID } from 'crypto'
import { loadAgentSDK } from './anthropic'
import { sendChunk, abortControllers, respondToApproval, buildPromptWithHistory, injectApiKeyEnv } from './streaming'
import { buildCwdRestrictionHooks } from './cwdHooks'
import { findBinaryInPath, ensureFreshMacOSToken } from '../utils/env'
import type { AISettings } from './streaming'
import type { ToolCall, ToolApprovalResponse, AskUserResponse, AskUserQuestion } from '../../shared/types'

// ─── Types ────────────────────────────────────────────────────

/** Matches the return type of streamMessage for drop-in compatibility */
export interface TurnResult {
  content: string
  toolCalls: ToolCall[]
  aborted: boolean
  sessionId: string | null
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
  lastStopReason?: string
  lastResultSubtype?: string
  /** Number of background tasks still running */
  pendingTaskCount: number
  turnEndDeferred: boolean
  /** Polling interval (30s) — pushes synthetic prompt to check agent status */
  pollInterval: ReturnType<typeof setInterval> | null
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
  pendingRequests: Map<string, { resolve: (value: unknown) => void; conversationId?: number }>
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
      await new Promise<void>((resolve) => {
        this.waiter = { resolve }
      })
    }
  }
}

// ─── Session Map ──────────────────────────────────────────────

const sessions = new Map<number, ActiveSession>()
const IDLE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const MAX_SESSIONS = 3

let idleTimer: ReturnType<typeof setInterval> | null = null

function startIdleTimer(): void {
  if (idleTimer) return
  idleTimer = setInterval(() => {
    const now = Date.now()
    for (const [convId, session] of sessions) {
      if (now - session.lastActivity > IDLE_TIMEOUT_MS && !session.currentTurn) {
        console.log(`[sessionManager] Idle cleanup: conversation ${convId}`)
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
    delta?: { type: string; text?: string; partial_json?: string }
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
    console.log(`[sessionManager] ⚠ BUFFERING chunk type="${type}" (pendingApprovalCount=${session.pendingApprovalCount}, bufferSize=${session.chunkBuffer.length + 1}) conv=${session.conversationId}`)
    session.chunkBuffer.push({ type, content, extra })
  } else {
    sendChunk(type, content, extra)
  }
}

function flushBuffer(session: ActiveSession): void {
  if (session.chunkBuffer.length > 0) {
    console.log(`[sessionManager] Flushing ${session.chunkBuffer.length} buffered chunks for conv ${session.conversationId}`)
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

// ─── Stream consumer ──────────────────────────────────────────

async function consumeStream(session: ActiveSession): Promise<void> {
  const convExtra: Record<string, number> = { conversationId: session.conversationId }
  let consecutiveEmptyExits = 0
  const MAX_EMPTY_EXITS = 3

  while (!session.closing) {
  let receivedAnyMessage = false

  try {
    for await (const message of session.query) {
      receivedAnyMessage = true
      consecutiveEmptyExits = 0
      session.lastMessageReceivedAt = Date.now()
      const msg = message as SDKMsg

      // Capture session_id from any message
      if (!session.sessionId && typeof (msg as Record<string, unknown>).session_id === 'string') {
        session.sessionId = (msg as Record<string, unknown>).session_id as string
      }

      const turn = session.currentTurn
      if (!turn) {
        // Between turns — only handle task_notification
        if (msg.type === 'system') {
          const sysMsg = msg as SystemMsg
          if (sysMsg.subtype === 'task_notification') {
            sendChunk('task_notification', sysMsg.summary, {
              ...convExtra,
              ...(sysMsg.task_id ? { taskId: sysMsg.task_id } : {}),
              ...(sysMsg.status ? { taskStatus: sysMsg.status } : {}),
              ...(sysMsg.output_file ? { outputFile: sysMsg.output_file } : {}),
            })
          }
        }
        continue
      }

      // ── Within a turn: process messages ──

      if (msg.type === 'stream_event') {
        const event = (msg as StreamEventMsg).event
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
          event?.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          event.delta.text
        ) {
          turn.content += event.delta.text
          sendOrBuffer(session, 'text', event.delta.text, convExtra)
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
                    console.log(`[sessionManager] ⏳ Background Task detected via tool input: ${turn.currentToolBlockId} — ${turn.pendingTaskCount} pending, conv ${session.conversationId}`)
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
      } else if (msg.type === 'result') {
        const result = msg as ResultMsg
        if (result.stop_reason) turn.lastStopReason = result.stop_reason
        if (result.subtype) turn.lastResultSubtype = result.subtype

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
          console.log(`[sessionManager] Turn end: subtype=${result.subtype} pendingTasks=${turn.pendingTaskCount} pendingApprovalCount=${session.pendingApprovalCount} bufferSize=${session.chunkBuffer.length} contentLen=${turn.content.length} conv=${session.conversationId}`)
          if (turn.pendingTaskCount > 0) {
            // Background tasks still running — defer done
            if (!turn.turnEndDeferred) {
              // First deferral: start polling every 30s
              turn.turnEndDeferred = true
              let pollCount = 0
              turn.pollInterval = setInterval(() => {
                pollCount++
                console.log(`[sessionManager] 🔄 Poll #${pollCount}: ${turn.pendingTaskCount} tasks pending, pushing status check prompt, conv ${session.conversationId}`)
                session.promptController.push({
                  type: 'user',
                  message: { role: 'user', content: 'Check if your background agents are done using the TaskOutput tool. Reply only "still running" or deliver results. Do not describe what agents are doing.' },
                  parent_tool_use_id: null,
                  session_id: session.sessionId || '',
                })
              }, 30_000)
              console.log(`[sessionManager] Turn end deferred: ${turn.pendingTaskCount} background tasks pending, polling every 30s, conv ${session.conversationId}`)
            } else {
              // Already deferred — poll prompt triggered this result/success, just log
              console.log(`[sessionManager] Turn end (poll response): pendingTasks=${turn.pendingTaskCount}, still waiting, conv ${session.conversationId}`)
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
            })
            session.currentTurn = null
            session.lastActivity = Date.now()
          }
        }
      } else if (msg.type === 'system') {
        const sysMsg = msg as SystemMsg
        if (sysMsg.subtype === 'init' && sysMsg.mcp_servers) {
          sendOrBuffer(session, 'mcp_status', undefined, {
            mcpServers: JSON.stringify(sysMsg.mcp_servers),
            ...convExtra,
          })
          for (const s of sysMsg.mcp_servers) {
            if (s.status !== 'connected') {
              console.error(`[sessionManager] MCP "${s.name}" status=${s.status} error=${JSON.stringify(s.error || null)}`)
            }
          }
        } else if (sysMsg.subtype === 'hook_response') {
          let systemMessage: string | undefined
          const raw = sysMsg.output || sysMsg.stdout || ''
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as { systemMessage?: string }
              systemMessage = parsed.systemMessage
            } catch { /* not JSON */ }
          }
          if (systemMessage) {
            sendOrBuffer(session, 'system_message', systemMessage, {
              ...convExtra,
              ...(sysMsg.hook_name ? { hookName: sysMsg.hook_name } : {}),
              ...(sysMsg.hook_event ? { hookEvent: sysMsg.hook_event } : {}),
            })
          }
        } else if (sysMsg.subtype === 'task_started' && sysMsg.task_id) {
          console.log(`[sessionManager] ▶ task_started: ${sysMsg.task_id} (${sysMsg.description || '?'}) — ${turn.pendingTaskCount} pending, conv ${session.conversationId}`)
        } else if (sysMsg.subtype === 'task_progress' && sysMsg.task_id) {
          console.log(`[sessionManager] ♥ task_progress: ${sysMsg.task_id} (${sysMsg.last_tool_name || '?'}) — ${turn.pendingTaskCount} pending, conv ${session.conversationId}`)
        } else if (sysMsg.subtype === 'task_notification') {
          // Background task completed/failed/stopped
          sendChunk('task_notification', sysMsg.summary, {
            ...convExtra,
            ...(sysMsg.task_id ? { taskId: sysMsg.task_id } : {}),
            ...(sysMsg.status ? { taskStatus: sysMsg.status } : {}),
            ...(sysMsg.output_file ? { outputFile: sysMsg.output_file } : {}),
          })

          // Simple decrement — no ID matching needed
          if (turn.pendingTaskCount > 0) turn.pendingTaskCount--
          console.log(`[sessionManager] ■ task_notification: ${sysMsg.task_id} status=${sysMsg.status} — ${turn.pendingTaskCount} pending, conv ${session.conversationId}`)

          if (turn.pendingTaskCount === 0 && turn.turnEndDeferred) {
            if (turn.pollInterval) { clearInterval(turn.pollInterval); turn.pollInterval = null }
            turn.turnEndDeferred = false
            console.log(`[sessionManager] All background tasks done — letting SDK continue to process results, conv ${session.conversationId}`)
            // DON'T send done here — let the SDK continue.
            // Claude will process the agent results and generate a response.
            // The next result/success will send done normally (pendingTaskCount is 0).
          }
        }
      }
    }

    // for-await exited normally → decide: reconnect or stop
    if (session.closing) break
    if (!session.sessionId) break

    // If tasks are still pending, DON'T reconnect — the old subprocess had the agents.
    // A new subprocess (via reconnect) won't have them. The safety-net timeout will handle it.
    const pendingTurn = session.currentTurn
    if (pendingTurn && pendingTurn.pendingTaskCount > 0 && pendingTurn.turnEndDeferred) {
      console.log(`[sessionManager] SDK iterable ended with ${pendingTurn.pendingTaskCount} pending tasks — NOT reconnecting (would orphan agents), conv ${session.conversationId}`)
      break
    }

    if (!receivedAnyMessage) {
      consecutiveEmptyExits++
      if (consecutiveEmptyExits >= MAX_EMPTY_EXITS) break
    }

    // Reconnect with resume (only when no pending background tasks)
    console.log(`[sessionManager] SDK iterable ended, reconnecting for conv ${session.conversationId}`)
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

  } catch (err: unknown) {
    // Query threw (subprocess crash, abort, etc.)
    const turn = session.currentTurn
    if (turn) {
      if (turn.pollInterval) { clearInterval(turn.pollInterval); turn.pollInterval = null }
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('abort'))
      ) {
        sendChunk('done', undefined, { conversationId: session.conversationId, stopReason: 'aborted' })
        turn.resolve({ content: turn.content, toolCalls: Array.from(turn.toolCallsMap.values()), aborted: true, sessionId: session.sessionId })
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Unknown streaming error'
        console.error('[sessionManager] Stream error:', err)
        sendChunk('error', errorMsg, { conversationId: session.conversationId })
        turn.reject(err instanceof Error ? err : new Error(errorMsg))
      }
      session.currentTurn = null
    }
    break
  }
  } // end while

  // Cleanup (only if not already cleaned by invalidateSession)
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

// ─── Session creation ─────────────────────────────────────────

const VALID_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'] as const
type ValidPermissionMode = typeof VALID_PERMISSION_MODES[number]

async function createSession(
  conversationId: number,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string | undefined,
  aiSettings: AISettings,
  sdkSessionId: string | null
): Promise<ActiveSession> {
  // Ensure fresh token
  if (!aiSettings?.apiKey) {
    await ensureFreshMacOSToken()
  }

  // Inject API key env
  const restoreEnv = injectApiKeyEnv(aiSettings?.apiKey, aiSettings?.baseUrl)

  const sdk = await loadAgentSDK()

  const promptController = new PromptController()

  const rawPermMode = aiSettings?.permissionMode || 'bypassPermissions'
  const permMode: ValidPermissionMode = (VALID_PERMISSION_MODES as readonly string[]).includes(rawPermMode)
    ? rawPermMode as ValidPermissionMode
    : 'bypassPermissions'

  const nodeExecutable = findBinaryInPath('node') ?? 'node'

  const queryOptions: Record<string, unknown> = {
    model: aiSettings?.model || undefined,
    systemPrompt: systemPrompt || undefined,
    maxTurns: aiSettings?.maxTurns || undefined,
    maxThinkingTokens: aiSettings?.maxThinkingTokens || undefined,
    maxBudgetUsd: aiSettings?.maxBudgetUsd || undefined,
    cwd: aiSettings?.cwd || undefined,
    includePartialMessages: true,
    permissionMode: permMode,
    executable: nodeExecutable,
  }

  // Resume existing SDK session when available
  if (sdkSessionId) {
    queryOptions.resume = sdkSessionId
  }

  if (permMode === 'bypassPermissions') {
    queryOptions.allowDangerouslySkipPermissions = true
  }

  // Create session state (partially — will be completed below)
  const session: ActiveSession = {
    query: null as unknown as ActiveSession['query'], // set after query creation
    conversationId,
    sessionId: null,
    promptController,
    streamConsumer: null as unknown as Promise<void>, // set below
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

  // canUseTool — shared across all turns in this session
  queryOptions.canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    console.log(`[sessionManager] canUseTool called: tool="${toolName}" permMode="${permMode}" pendingApprovalCount=${session.pendingApprovalCount} conv=${conversationId}`)
    // AskUserQuestion: always interactive
    if (toolName === 'AskUserQuestion') {
      const requestId = randomUUID()
      session.pendingApprovalCount++

      try {
        const questions = (input.questions ?? []) as AskUserQuestion[]
        sendChunk('ask_user', undefined, {
          requestId,
          questions: JSON.stringify(questions),
          conversationId,
        })

        const response = await new Promise<unknown>((resolve) => {
          session.pendingRequests.set(requestId, { resolve, conversationId })
        })

        const askResponse = response as AskUserResponse
        return {
          behavior: 'allow' as const,
          updatedInput: { ...input, answers: askResponse.answers },
        }
      } finally {
        session.pendingApprovalCount--
        if (session.pendingApprovalCount === 0) {
          flushBuffer(session)
        }
      }
    }

    // Deny disabled skills
    if (toolName === 'Skill' && aiSettings?.disabledSkills?.length) {
      const skillName = (input.skill || input.name || '') as string
      if (skillName && aiSettings.disabledSkills.includes(skillName)) {
        return { behavior: 'deny' as const, message: `Skill "${skillName}" is disabled` }
      }
    }

    // Bypass mode: auto-approve
    if (permMode === 'bypassPermissions') {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    // Non-bypass: tool approval flow
    const requestId = randomUUID()
    session.pendingApprovalCount++

    try {
      sendChunk('tool_approval', undefined, {
        requestId,
        toolName,
        toolInput: JSON.stringify(input),
        conversationId,
      })

      const response = await new Promise<unknown>((resolve) => {
        session.pendingRequests.set(requestId, { resolve, conversationId })
      })

      const approvalResponse = response as ToolApprovalResponse
      if (approvalResponse.behavior === 'allow') {
        return { behavior: 'allow' as const, updatedInput: input }
      } else {
        return { behavior: 'deny' as const, message: approvalResponse.message || 'User denied this action' }
      }
    } finally {
      session.pendingApprovalCount--
      if (session.pendingApprovalCount === 0) {
        flushBuffer(session)
      }
    }
  }

  // CWD restriction hooks
  if (aiSettings?.cwdRestrictionEnabled && aiSettings?.cwd) {
    queryOptions.hooks = buildCwdRestrictionHooks(aiSettings.cwd, aiSettings.cwdWhitelist || [])
  }

  if (aiSettings?.tools) {
    queryOptions.tools = aiSettings.tools
  }

  if (aiSettings?.mcpServers && Object.keys(aiSettings.mcpServers).length > 0) {
    queryOptions.mcpServers = aiSettings.mcpServers
    const mcpWildcards = Object.keys(aiSettings.mcpServers).map((name) => `mcp__${name}__*`)
    queryOptions.allowedTools = [
      ...(Array.isArray(queryOptions.allowedTools) ? queryOptions.allowedTools as string[] : []),
      ...mcpWildcards,
    ]
  }

  if (aiSettings?.skills && aiSettings.skills !== 'off') {
    const sourceMap: Record<string, string[]> = { user: ['user'], project: ['user', 'project'], local: ['user', 'project', 'local'] }
    queryOptions.settingSources = sourceMap[aiSettings.skills] || ['user']
  }

  if (aiSettings?.skills && aiSettings.skills !== 'off' && aiSettings?.skillsEnabled !== false) {
    queryOptions.allowedTools = [
      ...(Array.isArray(queryOptions.allowedTools) ? queryOptions.allowedTools as string[] : []),
      'Skill',
    ]
  }

  // Build the initial prompt: when resuming, send only the last user message
  const initialPrompt = sdkSessionId
    ? messages[messages.length - 1]?.content ?? ''
    : buildPromptWithHistory(messages)

  // Push initial message into the controller — the query will consume it
  promptController.push({
    type: 'user',
    message: { role: 'user', content: initialPrompt },
    parent_tool_use_id: null,
    session_id: '',
  })

  // Create the query with the async iterable prompt
  const abortController = new AbortController()
  abortControllers.set(conversationId, abortController)
  queryOptions.abortController = abortController

  // Save queryOptions for reconnection (abortController excluded — recreated each time)
  session.queryOptions = { ...queryOptions }
  delete session.queryOptions.abortController

  const agentQuery = sdk.query({
    prompt: promptController,
    options: queryOptions,
  })

  session.query = agentQuery as unknown as ActiveSession['query']

  // Start the background consumer
  session.streamConsumer = consumeStream(session)

  sessions.set(conversationId, session)
  startIdleTimer()

  // Evict oldest idle sessions if over limit
  if (sessions.size > MAX_SESSIONS) {
    let oldestConvId: number | null = null
    let oldestActivity = Infinity
    for (const [cid, s] of sessions) {
      if (!s.currentTurn && s.lastActivity < oldestActivity && cid !== conversationId) {
        oldestConvId = cid
        oldestActivity = s.lastActivity
      }
    }
    if (oldestConvId !== null) {
      console.log(`[sessionManager] LRU eviction: conversation ${oldestConvId}`)
      invalidateSession(oldestConvId)
    }
  }

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
      console.log(`[sessionManager] Settings changed, invalidating session for conversation ${conversationId}`)
      invalidateSession(conversationId)
      session = undefined
    }
  }

  // Invalidate if DB session was cleared (clear/compact/regenerate/edit)
  if (session && session.status === 'active' && sdkSessionId === null) {
    console.log(`[sessionManager] SDK session cleared in DB, invalidating in-memory session for conversation ${conversationId}`)
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
  let releaseLock: () => void
  session.turnLock = new Promise<void>((resolve) => { releaseLock = resolve })
  session.turnLockRelease = releaseLock!

  // Send initial 'text' chunk to signal stream start
  sendChunk('text', '', { conversationId })

  // Create deferred promise for this turn
  const turnResult = await new Promise<TurnResult>((resolve, reject) => {
    session!.currentTurn = {
      content: '',
      toolInputAccum: new Map(),
      toolCallsMap: new Map(),
      currentToolBlockId: null,
      askUserToolIds: new Set(),
      pendingTaskCount: 0,
      turnEndDeferred: false,
      pollInterval: null,
      resolve,
      reject,
    }
  })

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
  try { (session.query as { close(): void }).close() } catch { /* already closed */ }
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
    })
    session.currentTurn = null
  }

  // Release turn lock
  if (session.turnLockRelease) {
    session.turnLockRelease()
    session.turnLockRelease = null
  }

  console.log(`[sessionManager] Session invalidated for conversation ${conversationId}`)
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
