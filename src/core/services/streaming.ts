import { loadAgentSDK } from './anthropic'
import { applyAiSettingsToQueryOptions } from './sdkQueryOptions'
import { createCanUseTool } from './canUseTool'
import {
  forwardInitMcpStatus,
  forwardHookSystemMessage,
  forwardTaskNotification,
} from './sdkSystemForward'
import { findBinaryInPath } from '../utils/env'
import { broadcast } from '../utils/broadcast'
import { createLogger } from '../utils/logger'

const log = createLogger('streaming')
import type { ToolApprovalResponse, AskUserResponse, ToolCall, CwdWhitelistEntry } from '../types'

// ─── Injectable dependencies (set by the adapter layer) ─────

type MessageParam = { role: 'user' | 'assistant'; content: string }

export interface TurnUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  context_window?: number
}

type SendTurnFn = (
  conversationId: number,
  messages: MessageParam[],
  systemPrompt: string | undefined,
  aiSettings: AISettings,
  sdkSessionId: string | null,
) => Promise<{ content: string; toolCalls: ToolCall[]; aborted: boolean; sessionId: string | null; error?: string; stopReason?: string; usage?: TurnUsage }>

type RespondToSessionApprovalFn = (requestId: string, response: ToolApprovalResponse | AskUserResponse) => void
type AbortSessionFn = (conversationId: number) => void
type HasActiveSessionFn = (conversationId: number) => boolean

let _sendTurn: SendTurnFn | null = null
let _respondToSessionApproval: RespondToSessionApprovalFn | null = null
let _abortSession: AbortSessionFn | null = null
let _hasActiveSession: HasActiveSessionFn | null = null

/** Inject session manager functions. Called by the adapter layer (Electron or headless). */
export function setSessionManager(fns: {
  sendTurn: SendTurnFn
  respondToApproval: RespondToSessionApprovalFn
  abortSession: AbortSessionFn
  hasActiveSession: HasActiveSessionFn
}): void {
  _sendTurn = fns.sendTurn
  _respondToSessionApproval = fns.respondToApproval
  _abortSession = fns.abortSession
  _hasActiveSession = fns.hasActiveSession
}

type StreamMessagePIFn = (
  messages: MessageParam[],
  systemPrompt?: string,
  aiSettings?: AISettings,
  conversationId?: number,
) => Promise<{ content: string; toolCalls: ToolCall[]; aborted: boolean; sessionId: string | null; error?: string }>

let _streamMessagePI: StreamMessagePIFn | null = null

/** Inject PI backend streaming implementation. */
export function setPIBackend(fn: StreamMessagePIFn): void { _streamMessagePI = fn }

// ─── PI UI window provider injection ─────────────────
// streamingPI binds an Electron BrowserWindow to PiUIContext so extensions can
// send IPC events to the renderer. Headless wires this to a no-op.
type PIUIWindowLike = {
  webContents: { send: (channel: string, data: unknown) => void }
  isDestroyed: () => boolean
}
type PIUIWindowProviderFn = () => PIUIWindowLike | null
let _piUIWindowProvider: PIUIWindowProviderFn | null = null
/** Inject the PI UI window provider. Called by the adapter (Electron sets it to getMainWindow). */
export function setPIUIWindowProvider(fn: PIUIWindowProviderFn): void { _piUIWindowProvider = fn }
export function getPIUIWindowProvider(): PIUIWindowProviderFn | null { return _piUIWindowProvider }

// ─── PI scheduler bridge injection ───────────────────
// streamingPI exposes a custom `agent_scheduler` PI tool when a scheduler bridge
// socket is available. Electron registers the in-process scheduler bridge here;
// headless leaves it null (or registers its own taskRunner-backed bridge).
export interface PISchedulerBridgeAccessor {
  getMcpConfig: (conversationId: number) => unknown | null
  getSocketPath: () => string | null
  getAuthToken: () => string | null
}
let _piSchedulerBridge: PISchedulerBridgeAccessor | null = null
export function setPISchedulerBridge(bridge: PISchedulerBridgeAccessor | null): void { _piSchedulerBridge = bridge }
export function getPISchedulerBridge(): PISchedulerBridgeAccessor | null { return _piSchedulerBridge }

type EnsureFreshTokenFn = () => Promise<void>
let _ensureFreshMacOSToken: EnsureFreshTokenFn | null = null

/** Inject macOS OAuth token refresh function. */
export function setEnsureFreshToken(fn: EnsureFreshTokenFn): void { _ensureFreshMacOSToken = fn }

// ─── Conversation overrides writer injection ─────────
// Used by the PI parity extension (permission-modes' exit_plan_mode)
// to persist mode changes back to the conversation's ai_overrides.
// Implemented by the adapter (main) which has the db handle.
type UpdateConversationOverridesFn = (conversationId: number, patch: Record<string, string>) => void
let _updateConversationOverrides: UpdateConversationOverridesFn | null = null
export function setConversationOverridesWriter(fn: UpdateConversationOverridesFn): void {
  _updateConversationOverrides = fn
}
export function getConversationOverridesWriter(): UpdateConversationOverridesFn | null {
  return _updateConversationOverrides
}

// Per-conversation abort controllers: Map<conversationId, AbortController>
// Allows aborting a specific stream without affecting others
// Exported for use by alternative backend implementations (e.g. streamingPI)
export const abortControllers = new Map<number, AbortController>()

// Deferred promise map for tool approval / ask-user responses from the renderer.
// Exported for use by alternative backend implementations (e.g. streamingPI) so that
// respondToApproval() can resolve approvals regardless of which backend issued the request.
export const pendingRequests = new Map<string, { resolve: (value: unknown) => void; conversationId: string | number | null }>()

export function respondToApproval(requestId: string, response: ToolApprovalResponse | AskUserResponse): void {
  const pending = pendingRequests.get(requestId)
  if (pending) {
    pending.resolve(response)
    pendingRequests.delete(requestId)
    return
  }
  // Fall through to persistent session approval
  _respondToSessionApproval?.(requestId, response)
}

function denyAllPending(): void {
  for (const [id, entry] of pendingRequests) {
    entry.resolve({ behavior: 'deny', message: 'Request cancelled' } as ToolApprovalResponse)
    pendingRequests.delete(id)
  }
}

export function denyPendingForConversation(conversationId?: number): void {
  for (const [id, entry] of pendingRequests) {
    if (conversationId == null || entry.conversationId === conversationId) {
      entry.resolve({ behavior: 'deny', message: 'Request cancelled' } as ToolApprovalResponse)
      pendingRequests.delete(id)
    }
  }
}

// Injectable chunk sender — set by the Electron adapter (or any other transport)
type ChunkSenderFn = (channel: string, payload: Record<string, unknown>) => void
let _chunkSender: ChunkSenderFn | null = null

/** Set the chunk sender implementation. Called by the adapter layer. */
export function setChunkSender(fn: ChunkSenderFn): void { _chunkSender = fn }

export function sendChunk(type: string, content?: string, extra?: Record<string, string | number>): void {
  const payload = { type, content, ...extra }
  _chunkSender?.('messages:stream', payload)
  broadcast('messages:stream', payload)
}

export function buildPromptWithHistory(messages: MessageParam[]): string {
  const lastMessage = messages[messages.length - 1]
  const prompt = lastMessage?.content ?? ''

  if (messages.length <= 1) {
    return prompt
  }

  const historyParts: string[] = []
  for (const msg of messages.slice(0, -1)) {
    historyParts.push(`<msg role="${msg.role}">${msg.content}</msg>`)
  }

  return `<conversation_history>\n${historyParts.join('\n')}\n</conversation_history>\n\n${prompt}`
}

/**
 * Runtime transport config for spawning an MCP client connection.
 *
 * Distinct from `McpServerConfig` in `core/types/types.ts`, which is
 * the persisted DB/UI shape (with `name` field, all-optional fields).
 * This union is the minimal runtime contract: stdio (command + args)
 * or HTTP/SSE (type + url). The server name is the key in the parent
 * `Record<string, McpTransportConfig>`.
 */
export type McpTransportConfig =
  | { command: string; args: string[]; env?: Record<string, string> }
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }

export interface AISettings {
  sdkBackend?: string
  model?: string
  maxTurns?: number
  maxThinkingTokens?: number
  maxBudgetUsd?: number
  cwd?: string
  tools?: { type: 'preset'; preset: string } | string[]
  permissionMode?: string
  requirePlanApproval?: boolean
  mcpServers?: Record<string, McpTransportConfig>
  cwdRestrictionEnabled?: boolean
  cwdWhitelist?: CwdWhitelistEntry[]
  sharedHooks?: boolean
  skills?: 'off' | 'user' | 'project' | 'local'
  skillsEnabled?: boolean
  disabledSkills?: string[]
  /**
   * When true, also expose skills from CLAUDE-INSTALLED plugins
   * (`~/.claude/plugins/installed_plugins.json` → each entry's `<installPath>/skills`).
   *
   * - PI backend: `skillsBridge` reads the manifest and contributes the
   *   skill dirs via `resources_discover`.
   * - Claude backend: the SDK loads installed-plugin skills natively
   *   when `settingSources` is set; this flag is informational (no
   *   extra code path). Turning the flag OFF does NOT disable plugin
   *   skills on Claude — the SDK has no fine-grained toggle. Remove
   *   plugins via `claude plugin uninstall ...` if you need them gone.
   */
  skillsIncludePlugins?: boolean
  apiKey?: string
  baseUrl?: string
  ttsResponseMode?: 'off' | 'full' | 'summary' | 'auto'
  ttsAutoWordLimit?: number
  ttsSummaryPrompt?: string
  ttsSummaryModel?: string
  compactModel?: string
  titleModel?: string
  /** Last natively-selected model per backend — fallback for cross-backend id mapping. */
  lastModelByBackend?: Record<string, string>
  piDisabledExtensions?: string[]
  piExtensionsDir?: string
  webhookCompletionUrl?: string
}

/**
 * Inject ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL into process.env.
 * Returns a cleanup function that restores original values, or null if no injection was needed.
 */
export function injectApiKeyEnv(apiKey?: string, baseUrl?: string): (() => void) | null {
  if (!apiKey) return null
  const savedApiKey = process.env.ANTHROPIC_API_KEY
  const savedBaseUrl = process.env.ANTHROPIC_BASE_URL
  process.env.ANTHROPIC_API_KEY = apiKey
  if (baseUrl) {
    process.env.ANTHROPIC_BASE_URL = baseUrl
  } else {
    delete process.env.ANTHROPIC_BASE_URL
  }
  return () => {
    if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey
    else delete process.env.ANTHROPIC_API_KEY
    if (savedBaseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = savedBaseUrl
    else delete process.env.ANTHROPIC_BASE_URL
  }
}

interface StreamEventMessage {
  type: 'stream_event'
  event?: {
    type?: string
    delta?: { type: string; text?: string; partial_json?: string; thinking?: string }
    content_block?: { type: string; name?: string; id?: string }
  }
}

interface ResultMessage {
  type: 'result'
  subtype?: string
  stop_reason?: string
  tool_name?: string
  tool_use_id?: string
  summary?: string
  content?: string
}

interface SystemMessage {
  type: 'system'
  subtype?: string
  mcp_servers?: Array<{ name: string; status: string; error?: string }>
  // Hook fields (hook_started / hook_progress / hook_response)
  hook_id?: string
  hook_name?: string
  hook_event?: string
  output?: string
  stdout?: string
  stderr?: string
  exit_code?: number
  outcome?: string
  // task_notification fields
  task_id?: string
  status?: string
  output_file?: string
  summary?: string
}

type SDKMessage = StreamEventMessage | ResultMessage | SystemMessage | { type: string }

const VALID_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'] as const
type ValidPermissionMode = typeof VALID_PERMISSION_MODES[number]

export async function streamMessage(
  messages: MessageParam[],
  systemPrompt?: string,
  aiSettings?: AISettings,
  conversationId?: number,
  sdkSessionId?: string | null,
  persistSession?: boolean
): Promise<{ content: string; toolCalls: ToolCall[]; aborted: boolean; sessionId: string | null; error?: string; stopReason?: string; usage?: TurnUsage }> {
  // PI backend
  if (aiSettings?.sdkBackend === 'pi') {
    if (!_streamMessagePI) {
      return { content: '', toolCalls: [], aborted: false, sessionId: null, error: 'PI backend not configured' }
    }
    return _streamMessagePI(messages, systemPrompt, aiSettings, conversationId)
  }

  // One-shot: scheduler, no conversationId, or persistSession === false
  if (persistSession === false || conversationId == null) {
    return streamMessageOneShot(messages, systemPrompt, aiSettings, conversationId, sdkSessionId, persistSession)
  }

  // Persistent: delegate to SessionManager (falls back to one-shot if not injected)
  if (_sendTurn && aiSettings) {
    return _sendTurn(conversationId, messages, systemPrompt, aiSettings, sdkSessionId ?? null)
  }
  return streamMessageOneShot(messages, systemPrompt, aiSettings, conversationId, sdkSessionId, persistSession)
}

// ─── streamMessageOneShot helpers ─────────────────────

interface OneShotState {
  fullContent: string
  capturedSessionId: string | null
  toolInputAccum: Map<string, string>
  toolCallsMap: Map<string, ToolCall>
  currentToolBlockId: string | null
  askUserToolIds: Set<string>
  /** True between a content_block_start(thinking) and its matching content_block_stop. */
  thinkingBlockActive: boolean
  lastStopReason: string | undefined
  lastResultSubtype: string | undefined
}

interface ChunkBuffer {
  sendOrBuffer: (type: string, content?: string, extra?: Record<string, string | number>) => void
  onApprovalStart: () => void
  onApprovalEnd: () => void
}

function createChunkBuffer(): ChunkBuffer {
  let pendingApprovalCount = 0
  const chunkBuffer: Array<{ type: string; content?: string; extra?: Record<string, string | number> }> = []

  const flushBuffer = (): void => {
    while (chunkBuffer.length > 0) {
      const chunk = chunkBuffer.shift()!
      sendChunk(chunk.type, chunk.content, chunk.extra)
    }
  }

  return {
    sendOrBuffer: (type, content, extra) => {
      if (pendingApprovalCount > 0) {
        chunkBuffer.push({ type, content, extra })
      } else {
        sendChunk(type, content, extra)
      }
    },
    onApprovalStart: () => { pendingApprovalCount++ },
    onApprovalEnd: () => {
      pendingApprovalCount--
      if (pendingApprovalCount === 0) flushBuffer()
    },
  }
}

function buildOneShotQueryOptions(
  aiSettings: AISettings | undefined,
  systemPrompt: string | undefined,
  abortController: AbortController,
  sdkSessionId: string | null | undefined,
  persistSession: boolean | undefined,
  conversationId: number | undefined,
  convKey: number,
  buffer: ChunkBuffer,
): Record<string, unknown> {
  const rawPermMode = aiSettings?.permissionMode || 'bypassPermissions'
  const permMode: ValidPermissionMode = (VALID_PERMISSION_MODES as readonly string[]).includes(rawPermMode)
    ? rawPermMode as ValidPermissionMode
    : 'bypassPermissions'

  // Resolve node executable explicitly so the SDK can spawn cli.js even when
  // the app is launched from Finder/Dock (minimal PATH, no shell init scripts).
  const nodeExecutable = findBinaryInPath('node') ?? 'node'
  // Force the Claude Code CLI binary from PATH. Without this, the SDK's
  // bundled platform detection may pick the musl native variant on glibc
  // systems (`claude-agent-sdk-linux-x64-musl/claude`) and fail with
  // "Claude Code native binary not found". System claude (via `claude login`)
  // is the canonical install path on Linux.
  const claudeExecutable = findBinaryInPath('claude')

  const thinkingBudget = aiSettings?.maxThinkingTokens
  const queryOptions: Record<string, unknown> = {
    model: aiSettings?.model || undefined,
    systemPrompt: systemPrompt || undefined,
    maxTurns: aiSettings?.maxTurns || undefined,
    // Prefer the non-deprecated `thinking` config — `maxThinkingTokens` is
    // on/off on Opus 4.6 and may not emit thinking content blocks on some
    // model variants. Explicit budgetTokens guarantees the SDK emits them.
    ...(thinkingBudget && thinkingBudget > 0
      ? { thinking: { type: 'enabled', budgetTokens: thinkingBudget } }
      : {}),
    maxThinkingTokens: thinkingBudget || undefined,
    maxBudgetUsd: aiSettings?.maxBudgetUsd || undefined,
    cwd: aiSettings?.cwd || undefined,
    includePartialMessages: true,
    permissionMode: permMode,
    abortController,
    executable: nodeExecutable,
    ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
    ...(persistSession === false ? { persistSession: false } : {}),
  }

  if (sdkSessionId) {
    queryOptions.resume = sdkSessionId
  }

  if (permMode === 'bypassPermissions') {
    queryOptions.allowDangerouslySkipPermissions = true
  }

  // Canonical canUseTool — extracted factory shared with sessionManager.
  queryOptions.canUseTool = createCanUseTool({
    aiSettings: {
      requirePlanApproval: aiSettings?.requirePlanApproval,
      disabledSkills: aiSettings?.disabledSkills,
    },
    permissionMode: permMode,
    chunkConversationId: conversationId ?? null,
    pendingRequestsKey: convKey,
    pendingRequests,
    sendChunk,
    onApprovalStart: buffer.onApprovalStart,
    onApprovalEnd: buffer.onApprovalEnd,
  })

  applyAiSettingsToQueryOptions(queryOptions, aiSettings)

  return queryOptions
}

function handleStreamEventMessage(
  msg: StreamEventMessage,
  state: OneShotState,
  buffer: ChunkBuffer,
  convExtra: Record<string, number>,
): void {
  const event = msg.event
  if (
    event?.type === 'content_block_start' &&
    event.content_block?.type === 'tool_use'
  ) {
    const toolId = event.content_block.id || `tool_${Date.now()}`
    const toolName = event.content_block.name || 'tool'

    // AskUserQuestion is handled via canUseTool → ask_user chunk; suppress from tool pipeline
    if (toolName === 'AskUserQuestion') {
      state.askUserToolIds.add(toolId)
      state.currentToolBlockId = toolId
      state.toolInputAccum.set(toolId, '')
    } else {
      buffer.sendOrBuffer('tool_start', toolName, {
        toolName,
        toolId,
        ...convExtra,
      })
      state.currentToolBlockId = toolId
      state.toolInputAccum.set(toolId, '')
      // Create stub ToolCall immediately — guaranteed to fire since tools show during streaming
      state.toolCallsMap.set(toolId, { id: toolId, name: toolName, input: '{}', output: '', status: 'done' })
    }
  } else if (
    event?.type === 'content_block_start' &&
    event.content_block?.type === 'thinking'
  ) {
    // Open a thinking block. Wrap its deltas in <thinking>…</thinking> inside fullContent
    // so the renderer can split segments back out while preserving interleaved order.
    state.thinkingBlockActive = true
    state.fullContent += '<thinking>'
  } else if (
    event?.type === 'content_block_delta' &&
    event.delta?.type === 'text_delta' &&
    event.delta.text
  ) {
    state.fullContent += event.delta.text
    buffer.sendOrBuffer('text', event.delta.text, convExtra)
  } else if (
    event?.type === 'content_block_delta' &&
    event.delta?.type === 'thinking_delta' &&
    event.delta.thinking
  ) {
    state.fullContent += event.delta.thinking
    buffer.sendOrBuffer('thinking', event.delta.thinking, convExtra)
  }

  if (
    event?.type === 'content_block_delta' &&
    event.delta?.type === 'input_json_delta'
  ) {
    if (state.currentToolBlockId) {
      const existing = state.toolInputAccum.get(state.currentToolBlockId) || ''
      state.toolInputAccum.set(state.currentToolBlockId, existing + (event.delta.partial_json || ''))
    }
  }

  if (event?.type === 'content_block_stop') {
    if (state.thinkingBlockActive) {
      state.fullContent += '</thinking>\n'
      state.thinkingBlockActive = false
    }
    if (state.currentToolBlockId && state.toolInputAccum.has(state.currentToolBlockId)) {
      if (state.askUserToolIds.has(state.currentToolBlockId)) {
        // AskUserQuestion: skip tool_input chunk and toolCallsMap — handled via ask_user chunk
        state.currentToolBlockId = null
      } else {
        const inputJson = state.toolInputAccum.get(state.currentToolBlockId) || '{}'
        // Finalize input on the stub ToolCall
        const existing = state.toolCallsMap.get(state.currentToolBlockId)
        if (existing) {
          state.toolCallsMap.set(state.currentToolBlockId, { ...existing, input: inputJson })
        }
        buffer.sendOrBuffer('tool_input', undefined, {
          toolId: state.currentToolBlockId,
          toolInput: inputJson,
          ...convExtra,
        })
        state.currentToolBlockId = null
      }
    }
  }
}

function handleResultMessage(
  result: ResultMessage,
  state: OneShotState,
  buffer: ChunkBuffer,
  convExtra: Record<string, number>,
): void {
  // Capture stop_reason and subtype from every result message
  if (result.stop_reason) state.lastStopReason = result.stop_reason
  if (result.subtype) state.lastResultSubtype = result.subtype
  if (result.subtype !== 'tool_result' && !result.tool_name) return

  const toolName = result.tool_name || 'tool'
  const toolId = result.tool_use_id || `tool_${Date.now()}`

  // AskUserQuestion results handled via canUseTool — skip tool tracking
  if (state.askUserToolIds.has(toolId)) {
    state.askUserToolIds.delete(toolId)
    return
  }

  const summary = result.summary || ''
  const fullOutput = result.content || summary
  const inputJson = state.toolInputAccum.get(toolId) || '{}'

  // Enrich existing stub or create new entry
  const existing = state.toolCallsMap.get(toolId)
  state.toolCallsMap.set(toolId, {
    id: toolId,
    name: existing?.name || toolName,
    input: existing?.input || inputJson,
    output: fullOutput.slice(0, 50_000),
    status: 'done',
  })

  buffer.sendOrBuffer('tool_result', summary, {
    toolName,
    toolId,
    toolOutput: fullOutput.slice(0, 50_000),
    toolInput: inputJson,
    ...convExtra,
  })
}

function handleSystemMessage(
  sysMsg: SystemMessage,
  buffer: ChunkBuffer,
  convExtra: Record<string, number>,
): void {
  const sender = buffer.sendOrBuffer
  if (sysMsg.subtype === 'init' && sysMsg.mcp_servers) {
    forwardInitMcpStatus(sysMsg, sender, convExtra, '[streaming]')
    return
  }
  if (sysMsg.subtype === 'hook_response') {
    forwardHookSystemMessage(sysMsg, sender, convExtra)
    return
  }
  if (sysMsg.subtype === 'task_notification') {
    forwardTaskNotification(sysMsg, sender, convExtra)
  }
}

async function consumeAgentQuery(
  agentQuery: AsyncIterable<unknown>,
  state: OneShotState,
  buffer: ChunkBuffer,
  convExtra: Record<string, number>,
): Promise<void> {
  for await (const message of agentQuery) {
    const msg = message as SDKMessage

    // Capture session_id from any SDK message that carries it
    if (!state.capturedSessionId && typeof (msg as Record<string, unknown>).session_id === 'string') {
      state.capturedSessionId = (msg as Record<string, unknown>).session_id as string
    }

    if (msg.type === 'stream_event') {
      handleStreamEventMessage(msg as StreamEventMessage, state, buffer, convExtra)
    } else if (msg.type === 'result') {
      handleResultMessage(msg as ResultMessage, state, buffer, convExtra)
    } else if (msg.type === 'system') {
      handleSystemMessage(msg as SystemMessage, buffer, convExtra)
    }
  }
}

function newOneShotState(): OneShotState {
  return {
    fullContent: '',
    capturedSessionId: null,
    toolInputAccum: new Map(),
    toolCallsMap: new Map(),
    currentToolBlockId: null,
    askUserToolIds: new Set(),
    thinkingBlockActive: false,
    lastStopReason: undefined,
    lastResultSubtype: undefined,
  }
}

function sendDoneChunk(state: OneShotState, convExtra: Record<string, number>): void {
  sendChunk('done', undefined, {
    ...convExtra,
    ...(state.lastStopReason ? { stopReason: state.lastStopReason } : {}),
    ...(state.lastResultSubtype ? { resultSubtype: state.lastResultSubtype } : {}),
  })
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))
}

function buildOneShotPrompt(messages: MessageParam[], sdkSessionId: string | null | undefined): string {
  // When resuming an SDK session, send only the last user message (the SDK already has context)
  if (sdkSessionId) return messages[messages.length - 1]?.content ?? ''
  return buildPromptWithHistory(messages)
}

function registerOneShotAbortController(convKey: number): AbortController {
  // Abort any existing stream for this conversation before starting new one
  abortControllers.get(convKey)?.abort()
  const abortController = new AbortController()
  abortControllers.set(convKey, abortController)
  return abortController
}

function cleanupOneShotStream(
  convKey: number,
  abortController: AbortController,
  restoreEnv: (() => void) | null,
): void {
  // Only delete if this is still our controller (another stream may have replaced it)
  if (abortControllers.get(convKey) === abortController) {
    abortControllers.delete(convKey)
  }
  denyPendingForConversation(convKey)
  restoreEnv?.()
}

async function streamMessageOneShot(
  messages: MessageParam[],
  systemPrompt?: string,
  aiSettings?: AISettings,
  conversationId?: number,
  sdkSessionId?: string | null,
  persistSession?: boolean
): Promise<{ content: string; toolCalls: ToolCall[]; aborted: boolean; sessionId: string | null; error?: string; stopReason?: string }> {
  // Ensure the macOS OAuth token is fresh — skip when using API key auth
  if (!aiSettings?.apiKey && _ensureFreshMacOSToken) await _ensureFreshMacOSToken()

  // Inject API key / base URL into process.env for the SDK subprocess
  const restoreEnv = injectApiKeyEnv(aiSettings?.apiKey, aiSettings?.baseUrl)
  const sdk = await loadAgentSDK()

  const convKey = conversationId ?? -1
  const convExtra: Record<string, number> = conversationId != null ? { conversationId } : {}
  const abortController = registerOneShotAbortController(convKey)

  const state = newOneShotState()
  const buffer = createChunkBuffer()
  let aborted = false
  let streamError: string | undefined

  try {
    sendChunk('text', '', convExtra)
    const prompt = buildOneShotPrompt(messages, sdkSessionId)
    const queryOptions = buildOneShotQueryOptions(
      aiSettings, systemPrompt, abortController, sdkSessionId, persistSession, conversationId, convKey, buffer,
    )
    await consumeAgentQuery(sdk.query({ prompt, options: queryOptions }), state, buffer, convExtra)
    sendDoneChunk(state, convExtra)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      aborted = true
      sendChunk('done', undefined, { ...convExtra, stopReason: 'aborted' })
    } else {
      streamError = err instanceof Error ? err.message : 'Unknown streaming error'
      log.error('Stream error', err)
      sendChunk('error', streamError, convExtra)
    }
  } finally {
    cleanupOneShotStream(convKey, abortController, restoreEnv)
  }

  return {
    content: state.fullContent,
    toolCalls: Array.from(state.toolCallsMap.values()),
    aborted,
    sessionId: state.capturedSessionId,
    error: streamError,
    stopReason: state.lastStopReason,
  }
}

export function notifyConversationUpdated(conversationId: number): void {
  _chunkSender?.('messages:conversationUpdated', { conversationId })
  broadcast('messages:conversationUpdated', conversationId)
}

export function abortStream(conversationId?: number): void {
  denyPendingForConversation(conversationId)
  if (conversationId != null) {
    // Abort persistent session if active (handles cleanup internally)
    if (_hasActiveSession?.(conversationId)) {
      _abortSession?.(conversationId)
      return
    }
    const controller = abortControllers.get(conversationId)
    if (controller) {
      controller.abort()
      abortControllers.delete(conversationId)
    }
  } else {
    // No conversationId: abort all active streams (backward compat)
    for (const [key, controller] of abortControllers) {
      controller.abort()
      abortControllers.delete(key)
    }
  }
}

