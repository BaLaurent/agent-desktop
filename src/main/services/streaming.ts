import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { getMainWindow } from '../index'
import { loadAgentSDK } from './anthropic'
import { buildCwdRestrictionHooks } from './cwdHooks'
import { findBinaryInPath, ensureFreshMacOSToken } from '../utils/env'
import type { ToolApprovalResponse, AskUserResponse, AskUserQuestion, ToolCall } from '../../shared/types'

// Per-conversation abort controllers: Map<conversationId, AbortController>
// Allows aborting a specific stream without affecting others
const abortControllers = new Map<number, AbortController>()

// Deferred promise map for tool approval / ask-user responses from the renderer
const pendingRequests = new Map<string, { resolve: (value: unknown) => void; conversationId?: number }>()

export function respondToApproval(requestId: string, response: ToolApprovalResponse | AskUserResponse): void {
  const pending = pendingRequests.get(requestId)
  if (pending) {
    pending.resolve(response)
    pendingRequests.delete(requestId)
  }
}

function denyAllPending(): void {
  for (const [id, entry] of pendingRequests) {
    entry.resolve({ behavior: 'deny', message: 'Request cancelled' } as ToolApprovalResponse)
    pendingRequests.delete(id)
  }
}

function denyPendingForConversation(conversationId?: number): void {
  for (const [id, entry] of pendingRequests) {
    if (conversationId == null || entry.conversationId === conversationId) {
      entry.resolve({ behavior: 'deny', message: 'Request cancelled' } as ToolApprovalResponse)
      pendingRequests.delete(id)
    }
  }
}

// Registry of windows that receive stream events (main window + overlay)
const streamWindows = new Set<BrowserWindow>()

export function registerStreamWindow(win: BrowserWindow): void {
  streamWindows.add(win)
  win.on('closed', () => streamWindows.delete(win))
}

function sendChunk(type: string, content?: string, extra?: Record<string, string | number>): void {
  const payload = { type, content, ...extra }

  // Broadcast to all registered windows
  for (const win of streamWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send('messages:stream', payload)
    }
  }

  // Fallback: if no windows registered, try mainWindow (backward compat)
  if (streamWindows.size === 0) {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('messages:stream', payload)
    }
  }
}

interface MessageParam {
  role: 'user' | 'assistant'
  content: string
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

export interface AISettings {
  model?: string
  maxTurns?: number
  maxThinkingTokens?: number
  maxBudgetUsd?: number
  cwd?: string
  tools?: { type: 'preset'; preset: string } | string[]
  permissionMode?: string
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> } | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>
  cwdRestrictionEnabled?: boolean
  writableKnowledgePaths?: string[]
  skills?: 'off' | 'user' | 'project' | 'local'
  skillsEnabled?: boolean
  disabledSkills?: string[]
  apiKey?: string
  baseUrl?: string
  ttsResponseMode?: 'off' | 'full' | 'summary' | 'auto'
  ttsAutoWordLimit?: number
  ttsSummaryPrompt?: string
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
    delta?: { type: string; text?: string; partial_json?: string }
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
}

type SDKMessage = StreamEventMessage | ResultMessage | SystemMessage | { type: string }

const VALID_PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'] as const
type ValidPermissionMode = typeof VALID_PERMISSION_MODES[number]

export async function streamMessage(
  messages: MessageParam[],
  systemPrompt?: string,
  aiSettings?: AISettings,
  conversationId?: number
): Promise<{ content: string; toolCalls: ToolCall[]; aborted: boolean }> {
  // Ensure the macOS OAuth token is fresh — skip when using API key auth
  if (!aiSettings?.apiKey) {
    await ensureFreshMacOSToken()
  }

  // Inject API key / base URL into process.env for the SDK subprocess
  const restoreEnv = injectApiKeyEnv(aiSettings?.apiKey, aiSettings?.baseUrl)

  const sdk = await loadAgentSDK()

  const convKey = conversationId ?? -1

  // Abort any existing stream for this conversation before starting new one
  const existing = abortControllers.get(convKey)
  if (existing) existing.abort()

  const abortController = new AbortController()
  abortControllers.set(convKey, abortController)

  let fullContent = ''
  let aborted = false

  const convExtra = conversationId != null ? { conversationId } : {}

  const toolInputAccum = new Map<string, string>()
  const toolCallsMap = new Map<string, ToolCall>()
  let currentToolBlockId: string | null = null
  // Track AskUserQuestion tool IDs to suppress them from regular tool streaming/persistence
  const askUserToolIds = new Set<string>()
  // Capture SDK result metadata for notification routing in the renderer
  let lastStopReason: string | undefined
  let lastResultSubtype: string | undefined

  try {
    sendChunk('text', '', convExtra)

    const prompt = buildPromptWithHistory(messages)

    const rawPermMode = aiSettings?.permissionMode || 'bypassPermissions'
    const permMode: ValidPermissionMode = (VALID_PERMISSION_MODES as readonly string[]).includes(rawPermMode)
      ? rawPermMode as ValidPermissionMode
      : 'bypassPermissions'

    // Resolve node executable explicitly so the SDK can spawn cli.js even when
    // the app is launched from Finder/Dock (minimal PATH, no shell init scripts).
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
      abortController,
      executable: nodeExecutable,
    }

    // Buffer for chunks received while awaiting tool approval
    // The SDK subprocess may yield buffered messages even while canUseTool is pending
    let pendingApprovalCount = 0
    const chunkBuffer: Array<{ type: string; content?: string; extra?: Record<string, string | number> }> = []

    function flushBuffer(): void {
      while (chunkBuffer.length > 0) {
        const chunk = chunkBuffer.shift()!
        sendChunk(chunk.type, chunk.content, chunk.extra)
      }
    }

    function sendOrBuffer(type: string, content?: string, extra?: Record<string, string | number>): void {
      if (pendingApprovalCount > 0) {
        chunkBuffer.push({ type, content, extra })
      } else {
        sendChunk(type, content, extra)
      }
    }

    if (permMode === 'bypassPermissions') {
      queryOptions.allowDangerouslySkipPermissions = true
    }

    // Always set canUseTool — AskUserQuestion needs interactive handling in all modes
    queryOptions.canUseTool = async (toolName: string, input: Record<string, unknown>) => {
      // AskUserQuestion: always interactive, regardless of permission mode
      if (toolName === 'AskUserQuestion') {
        const requestId = randomUUID()
        pendingApprovalCount++

        try {
          const questions = (input.questions ?? []) as AskUserQuestion[]
          sendChunk('ask_user', undefined, {
            requestId,
            questions: JSON.stringify(questions),
            ...convExtra,
          })

          const response = await new Promise<unknown>((resolve) => {
            pendingRequests.set(requestId, { resolve, conversationId: convKey })
          })

          const askResponse = response as AskUserResponse
          return {
            behavior: 'allow' as const,
            updatedInput: { ...input, answers: askResponse.answers },
          }
        } finally {
          pendingApprovalCount--
          if (pendingApprovalCount === 0) {
            flushBuffer()
          }
        }
      }

      // Deny disabled skills (checked before bypass mode — even bypass can't override)
      if (toolName === 'Skill' && aiSettings?.disabledSkills?.length) {
        const skillName = (input.skill || input.name || '') as string
        if (skillName && aiSettings.disabledSkills.includes(skillName)) {
          return { behavior: 'deny' as const, message: `Skill "${skillName}" is disabled` }
        }
      }

      // Bypass mode: auto-approve everything else immediately
      if (permMode === 'bypassPermissions') {
        return { behavior: 'allow' as const, updatedInput: input }
      }

      // Non-bypass: existing tool approval flow
      const requestId = randomUUID()
      pendingApprovalCount++

      try {
        sendChunk('tool_approval', undefined, {
          requestId,
          toolName,
          toolInput: JSON.stringify(input),
          ...convExtra,
        })

        const response = await new Promise<unknown>((resolve) => {
          pendingRequests.set(requestId, { resolve, conversationId: convKey })
        })

        const approvalResponse = response as ToolApprovalResponse
        if (approvalResponse.behavior === 'allow') {
          return { behavior: 'allow' as const, updatedInput: input }
        } else {
          return { behavior: 'deny' as const, message: approvalResponse.message || 'User denied this action' }
        }
      } finally {
        pendingApprovalCount--
        if (pendingApprovalCount === 0) {
          flushBuffer()
        }
      }
    }

    // CWD restriction hooks: runs independently of permission mode (even in bypass)
    // Uses the SDK hooks API — PreToolUse hook with 'deny' decision for out-of-CWD writes
    if (aiSettings?.cwdRestrictionEnabled && aiSettings?.cwd) {
      queryOptions.hooks = buildCwdRestrictionHooks(aiSettings.cwd, aiSettings.writableKnowledgePaths)
    }

    if (aiSettings?.tools) {
      queryOptions.tools = aiSettings.tools
    }

    if (aiSettings?.mcpServers && Object.keys(aiSettings.mcpServers).length > 0) {
      queryOptions.mcpServers = aiSettings.mcpServers
      // MCP tools require explicit allowedTools wildcards for the SDK to permit their use
      const mcpWildcards = Object.keys(aiSettings.mcpServers).map(
        (name) => `mcp__${name}__*`
      )
      queryOptions.allowedTools = [
        ...(Array.isArray(queryOptions.allowedTools) ? queryOptions.allowedTools as string[] : []),
        ...mcpWildcards,
      ]
    }

    // Setting Sources: load configuration from filesystem (independent of skills toggle)
    if (aiSettings?.skills && aiSettings.skills !== 'off') {
      const sourceMap: Record<string, string[]> = { user: ['user'], project: ['user', 'project'], local: ['user', 'project', 'local'] }
      queryOptions.settingSources = sourceMap[aiSettings.skills] || ['user']
    }

    // Skills tool: only add when sources are active AND skills toggle is ON
    if (aiSettings?.skills && aiSettings.skills !== 'off' && aiSettings?.skillsEnabled !== false) {
      queryOptions.allowedTools = [
        ...(Array.isArray(queryOptions.allowedTools) ? queryOptions.allowedTools as string[] : []),
        'Skill',
      ]
    }

    const agentQuery = sdk.query({
      prompt,
      options: queryOptions,
    })

    for await (const message of agentQuery) {
      const msg = message as SDKMessage

      if (msg.type === 'stream_event') {
        const event = msg.event as {
          type?: string
          delta?: { type: string; text?: string; partial_json?: string }
          content_block?: { type: string; name?: string; id?: string }
        } | undefined

        if (
          event?.type === 'content_block_start' &&
          event.content_block?.type === 'tool_use'
        ) {
          const toolId = event.content_block.id || `tool_${Date.now()}`
          const toolName = event.content_block.name || 'tool'

          // AskUserQuestion is handled via canUseTool → ask_user chunk; suppress from tool pipeline
          if (toolName === 'AskUserQuestion') {
            askUserToolIds.add(toolId)
            currentToolBlockId = toolId
            toolInputAccum.set(toolId, '')
          } else {
            sendOrBuffer('tool_start', toolName, {
              toolName,
              toolId,
              ...convExtra,
            })
            currentToolBlockId = toolId
            toolInputAccum.set(toolId, '')
            // Create stub ToolCall immediately — guaranteed to fire since tools show during streaming
            toolCallsMap.set(toolId, { id: toolId, name: toolName, input: '{}', output: '', status: 'done' })
          }
        } else if (
          event?.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          event.delta.text
        ) {
          fullContent += event.delta.text
          sendOrBuffer('text', event.delta.text, convExtra)
        }

        if (
          event?.type === 'content_block_delta' &&
          event.delta?.type === 'input_json_delta'
        ) {
          if (currentToolBlockId) {
            const existing = toolInputAccum.get(currentToolBlockId) || ''
            toolInputAccum.set(currentToolBlockId, existing + (event.delta.partial_json || ''))
          }
        }

        if (event?.type === 'content_block_stop' && currentToolBlockId && toolInputAccum.has(currentToolBlockId)) {
          if (askUserToolIds.has(currentToolBlockId)) {
            // AskUserQuestion: skip tool_input chunk and toolCallsMap — handled via ask_user chunk
            currentToolBlockId = null
          } else {
            const inputJson = toolInputAccum.get(currentToolBlockId) || '{}'
            // Finalize input on the stub ToolCall
            const existing = toolCallsMap.get(currentToolBlockId)
            if (existing) {
              toolCallsMap.set(currentToolBlockId, { ...existing, input: inputJson })
            }
            sendOrBuffer('tool_input', undefined, {
              toolId: currentToolBlockId,
              toolInput: inputJson,
              ...convExtra,
            })
            currentToolBlockId = null
          }
        }
      } else if (msg.type === 'result') {
        const result = msg as ResultMessage
        // Capture stop_reason and subtype from every result message
        if (result.stop_reason) lastStopReason = result.stop_reason
        if (result.subtype) lastResultSubtype = result.subtype
        if (result.subtype === 'tool_result' || result.tool_name) {
          const toolName = result.tool_name || 'tool'
          const toolId = result.tool_use_id || `tool_${Date.now()}`

          // AskUserQuestion results handled via canUseTool — skip tool tracking
          if (askUserToolIds.has(toolId)) {
            askUserToolIds.delete(toolId)
          } else {
            const summary = result.summary || ''
            const fullOutput = result.content || summary
            const inputJson = toolInputAccum.get(toolId) || '{}'

            // Enrich existing stub or create new entry
            const existing = toolCallsMap.get(toolId)
            toolCallsMap.set(toolId, {
              id: toolId,
              name: existing?.name || toolName,
              input: existing?.input || inputJson,
              output: fullOutput.slice(0, 50_000),
              status: 'done',
            })

            sendOrBuffer('tool_result', summary, {
              toolName,
              toolId,
              toolOutput: fullOutput.slice(0, 50_000),
              toolInput: inputJson,
              ...convExtra,
            })
          }
        }
      } else if (msg.type === 'system') {
        const sysMsg = msg as SystemMessage
        if (sysMsg.subtype === 'init' && sysMsg.mcp_servers) {
          sendOrBuffer('mcp_status', undefined, {
            mcpServers: JSON.stringify(sysMsg.mcp_servers),
            ...convExtra,
          })
          for (const s of sysMsg.mcp_servers) {
            if (s.status !== 'connected') {
              console.error(`[streaming] MCP "${s.name}" ${s.status}: ${s.error || 'unknown error'}`)
            }
          }
        }
      }
    }

    sendChunk('done', undefined, {
      ...convExtra,
      ...(lastStopReason ? { stopReason: lastStopReason } : {}),
      ...(lastResultSubtype ? { resultSubtype: lastResultSubtype } : {}),
    })
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.includes('abort'))
    ) {
      aborted = true
      sendChunk('done', undefined, { ...convExtra, stopReason: 'aborted' })
    } else {
      const errorMsg = err instanceof Error ? err.message : 'Unknown streaming error'
      console.error('[streaming] Error:', err)
      sendChunk('error', errorMsg, convExtra)
    }
  } finally {
    // Only delete if this is still our controller (another stream may have replaced it)
    if (abortControllers.get(convKey) === abortController) {
      abortControllers.delete(convKey)
    }
    denyPendingForConversation(convKey)
    // Restore original env vars after streaming completes
    restoreEnv?.()
  }

  return { content: fullContent, toolCalls: Array.from(toolCallsMap.values()), aborted }
}

export function abortStream(conversationId?: number): void {
  denyPendingForConversation(conversationId)
  if (conversationId != null) {
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

