// ─── PI SDK vs Claude Agent SDK asymmetry — DO NOT FUSE ──────────────────────
//
// The Claude Agent SDK uses ChatCompletionStreamEvent (async iterables) + has an
// approval-pending buffer that suspends the stream during tool approval.
// The PI SDK uses session.subscribe() (synchronous callback) + per-turn
// createAgentSession() + NO approval buffer. sdkSystemForward.ts functions
// (forwardInitMcpStatus, forwardHookSystemMessage, forwardTaskNotification) are
// Claude-SDK-specific and WILL NOT work with PI events. Do not import or copy
// sdkSystemForward.ts into this file or any file under src/core/services/pi/.
// ─────────────────────────────────────────────────────────────────────────────

import {
  sendChunk,
  abortControllers,
  denyPendingForConversation,
  getPISchedulerBridge,
} from './streaming'
import { loadPISdk } from '../../main/services/piSdk'
import { existsSync } from 'node:fs'
import { getConversationPiSessionFile, setConversationPiSessionFile } from '../handlers/messages'
import { getDatabase } from '../db/database'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'
import type { AISettings } from './streaming'
import type { ToolCall } from '../../shared/types'
import type { AgentToolResult } from '@mariozechner/pi-agent-core'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { buildSessionConfig } from './pi/buildSessionConfig'
import { buildCustomTools } from './pi/buildCustomTools'
import { runSession } from './pi/runSession'
import { resolvePIModelObject } from './pi/resolveModel'
import { createLogger } from '../utils/logger'

const log = createLogger('streamingPI')

// Tool parameters schema for scheduler tool
const SchedulerToolParams = /* #__PURE__ */ (() =>
  Type.Object({
    conversation_id: Type.Number({ description: 'Conversation ID for the task', minimum: 1 }),
    command: Type.String({ description: 'Command to execute: "create", "list", or "cancel"' }),
    name: Type.Optional(Type.String({ description: 'Task name (for create)' })),
    prompt: Type.Optional(Type.String({ description: 'Task prompt (for create)' })),
    interval_value: Type.Optional(Type.Integer({ description: 'Interval value in units (for create)', minimum: 1 })),
    interval_unit: Type.Optional(Type.String({ description: 'Interval unit: minutes/hours/days (for create)' })),
    schedule_time: Type.Optional(Type.String({ description: 'Schedule time HH:MM (for create)' })),
    max_runs: Type.Optional(Type.Integer({ description: 'Max runs (for create)', minimum: 1 })),
    task_id: Type.Optional(Type.Integer({ description: 'Task ID (for cancel)', minimum: 1 })),
  }))()

interface SchedulerToolParams extends Static<typeof SchedulerToolParams> {}

interface SchedulerBridgeResponse {
  id?: number
  name?: string
  next_run_at?: string
  max_runs?: number | null
  deleted?: boolean
  result?: unknown[]
  error?: string
}

interface SchedulerTask {
  id: number
  name: string
  prompt: string
  enabled: boolean
  interval_value: number
  interval_unit: string
  max_runs: number | null
  next_run_at: string
  last_status: string
  run_count: number
}

// Execute command via scheduler bridge socket
async function executeSchedulerCommand(
  conversationId: number,
  command: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const bridge = getPISchedulerBridge()
  const schedSocketPath = bridge?.getSocketPath() ?? null
  const schedAuthToken = bridge?.getAuthToken() ?? null
  if (!schedSocketPath || !schedAuthToken) {
    throw new Error('Scheduler bridge not started')
  }

  const net = await import('net')
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(schedSocketPath, () => {
      const request = JSON.stringify({
        method: `scheduler.${command}`,
        token: schedAuthToken,
        params: { conversation_id: conversationId, ...params },
      })
      socket.write(request + '\n')
    })

    let buffer = ''
    let resolved = false

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const response = JSON.parse(trimmed) as SchedulerBridgeResponse
          if (!resolved) {
            resolved = true
            if (response.error) {
              reject(new Error(response.error))
            } else {
              resolve(response)
            }
          }
        } catch {
          // Continue accumulating
        }
      }
    })

    socket.on('error', (err) => {
      if (!resolved) {
        reject(err)
      }
    })

    socket.on('close', () => {
      if (!resolved) {
        resolve(null)
      }
    })

    // Timeout after 5 seconds
    socket.setTimeout(5000, () => {
      socket.destroy()
      if (!resolved) {
        resolved = true
        reject(new Error('Scheduler bridge timeout'))
      }
    })
  })
}

// Create PI tool definition for scheduler
function createSchedulerTool(): ToolDefinition {
  return {
    name: 'agent_scheduler',
    label: 'Agent Scheduler',
    description: 'Schedule tasks to run at specific times or intervals. Use this tool to create, list, or cancel scheduled tasks for the current conversation.',
    parameters: SchedulerToolParams,
    async execute(_toolCallId, params: SchedulerToolParams, _signal, _onUpdate, _ctx): Promise<AgentToolResult> {
      const result = await executeSchedulerCommand(params.conversation_id, params.command, {
        name: params.name,
        prompt: params.prompt,
        interval_value: params.interval_value,
        interval_unit: params.interval_unit,
        schedule_time: params.schedule_time,
        max_runs: params.max_runs,
        task_id: params.task_id,
      })

      // Format result for display
      if (params.command === 'list' && Array.isArray(result)) {
        const tasks = result as SchedulerTask[]
        const formatted = tasks.map((t) => {
          const nextRun = t.next_run_at ? new Date(t.next_run_at).toLocaleString() : 'N/A'
          return `#${t.id} ${t.enabled ? '✅' : '⏸️'} ${t.name} (${t.interval_value}${t.interval_unit}) - ${nextRun} (run #${t.run_count})`
        })
        return { content: [{ type: 'text', text: formatted.length ? formatted.join('\n') : 'No scheduled tasks' }] }
      } else if (params.command === 'create') {
        const r = result as { id: number; name: string; next_run_at?: string; max_runs?: number | null }
        return {
          content: [{ type: 'text', text: `Task created: ID ${r.id} "${r.name}" (next: ${r.next_run_at ?? 'N/A'})` }],
        }
      } else if (params.command === 'cancel') {
        return { content: [{ type: 'text', text: result && typeof result === 'object' && 'deleted' in result ? 'Task cancelled' : 'Cancel result unknown' }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  }
}

interface MessageParam {
  role: 'user' | 'assistant'
  content: string
}

// Session-scoped key/value stores for the parity extension, keyed by
// conversationId. Persist across multiple streamMessagePI invocations for
// the same conversation (unlike the factory closure, which is rebuilt per
// user message). Used for the dontAsk approval cache and any future
// cross-turn state a module needs.
const sessionStores = new Map<number, Map<string, unknown>>()

function getOrCreateSessionStore(conversationId: number): Map<string, unknown> {
  let store = sessionStores.get(conversationId)
  if (!store) {
    store = new Map<string, unknown>()
    sessionStores.set(conversationId, store)
  }
  return store
}

type PiSdk = Awaited<ReturnType<typeof loadPISdk>>

async function resolveSessionManager(
  pi: PiSdk,
  conversationId: number | undefined,
  cwd: string,
): Promise<{ sessionManager: unknown; persistAfterCreate: () => void }> {
  // No conversationId (one-shot) -> in-memory, no persistence
  if (conversationId == null) {
    return {
      sessionManager: pi.SessionManager.inMemory(cwd),
      persistAfterCreate: () => {},
    }
  }

  let db: ReturnType<typeof getDatabase> | null = null
  try {
    db = getDatabase()
  } catch {
    // DB not yet initialised (unlikely in production, but guard for tests)
  }

  if (!db) {
    return {
      sessionManager: pi.SessionManager.inMemory(cwd),
      persistAfterCreate: () => {},
    }
  }

  // Try to resume from an existing file
  const existingFile = getConversationPiSessionFile(db, conversationId)
  if (existingFile && existsSync(existingFile)) {
    try {
      const sm = pi.SessionManager.open(existingFile)
      return { sessionManager: sm, persistAfterCreate: () => {} }
    } catch (err) {
      log.warn('SessionManager.open failed, falling back to create', err)
      setConversationPiSessionFile(db, conversationId, null)
      // fall through to create
    }
  }

  // Create fresh -- sessionFile is assigned inside newSession() on construction,
  // so getSessionFile() is populated immediately after create() returns.
  const sm = pi.SessionManager.create(cwd)
  const capturedDb = db
  return {
    sessionManager: sm,
    persistAfterCreate: () => {
      const filepath = (sm as { getSessionFile?: () => string | undefined }).getSessionFile?.()
      if (filepath) setConversationPiSessionFile(capturedDb, conversationId, filepath)
    },
  }
}

function mapThinkingLevel(maxThinkingTokens?: number): 'off' | 'low' | 'medium' | 'high' {
  if (!maxThinkingTokens || maxThinkingTokens === 0) return 'off'
  if (maxThinkingTokens <= 10000) return 'low'
  if (maxThinkingTokens <= 50000) return 'medium'
  return 'high'
}

export async function streamMessagePI(
  messages: MessageParam[],
  systemPrompt: string | undefined,
  aiSettings: AISettings | undefined,
  conversationId: number | undefined,
): Promise<{ content: string; toolCalls: ToolCall[]; aborted: boolean; sessionId: string | null; stopReason?: string }> {
  log.debug('Using PI-SDK backend', { conversationId })
  const pi = await loadPISdk()

  const convKey = conversationId ?? -1
  const convExtra = conversationId != null ? { conversationId } : {}
  const accumulator = { fullContent: '', toolCallsMap: new Map<string, ToolCall>() }
  let aborted = false

  abortControllers.get(convKey)?.abort()
  const abortController = new AbortController()
  abortControllers.set(convKey, abortController)

  const mcpHandles: import('./mcpClient').McpClientHandle[] = []

  try {
    sendChunk('text', '', convExtra)

    const sessionConfig = await buildSessionConfig({
      aiSettings,
      conversationId,
      convKey,
      piSdk: pi as Parameters<typeof buildSessionConfig>[0]['piSdk'],
      sessionStore: getOrCreateSessionStore(convKey),
    })

    const { customTools, mcpHandles: spawnedHandles } = await buildCustomTools({
      createSchedulerTool,
      schedulerBridge: getPISchedulerBridge(),
      convKey,
      isUnattended: aiSettings?.requirePlanApproval === false,
      mcpServers: aiSettings?.mcpServers ?? {},
      canUseTool: sessionConfig.canUseTool,
      bypass: sessionConfig.bypass,
      convExtra,
    })
    mcpHandles.push(...spawnedHandles)

    const { sessionManager, persistAfterCreate } = await resolveSessionManager(
      pi,
      conversationId,
      aiSettings?.cwd || process.cwd(),
    )

    // Resolve the user's model id (e.g. "kilo/kilo-auto/free") into the
    // Model<any> object PI's createAgentSession actually needs. Surface
    // resolution failures explicitly — the SDK silently falls back to its
    // default model otherwise, which historically masked the real cause
    // behind misleading "OAuth forbidden / no API key" errors.
    let resolvedModel: unknown | undefined
    try {
      resolvedModel = await resolvePIModelObject(
        pi as Parameters<typeof resolvePIModelObject>[0],
        aiSettings?.model,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      sendChunk('error', `Model resolution failed: ${msg}`, convExtra)
      throw err
    }

    aborted = await runSession({
      pi,
      cwd: aiSettings?.cwd || process.cwd(),
      sessionManager,
      thinkingLevel: mapThinkingLevel(aiSettings?.maxThinkingTokens),
      tools: sessionConfig.gatedCodingTools,
      customTools,
      resourceLoader: sessionConfig.resourceLoader,
      persistAfterCreate,
      abortController,
      messages,
      systemPrompt,
      convKey,
      convExtra,
      accumulator,
      // Resolved Model<any> object — the SDK silently ignores string ids
      // and falls back to its default model. resolvePIModelObject mirrors
      // exactly what the pi-coding-agent CLI does internally.
      model: resolvedModel,
    })
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
      aborted = true
      sendChunk('done', undefined, { ...convExtra, stopReason: 'aborted' })
    } else {
      const errorMsg = err instanceof Error ? err.message : 'Unknown PI-SDK streaming error'
      log.error('Stream error', err)
      sendChunk('error', errorMsg, convExtra)
    }
  } finally {
    await Promise.allSettled(mcpHandles.map((h) => h.close()))
    if (abortControllers.get(convKey) === abortController) {
      abortControllers.delete(convKey)
    }
    denyPendingForConversation(convKey)
  }

  return { content: accumulator.fullContent, toolCalls: Array.from(accumulator.toolCallsMap.values()), aborted, sessionId: null, stopReason: aborted ? 'aborted' : 'end_turn' }
}
