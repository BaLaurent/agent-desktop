// ─── Oh My Pi (omp) backend — RPC subprocess orchestrator ────────────────────
//
// Replaces the former in-process @mariozechner PI backend (streamingPI.ts).
// Oh My Pi is a Bun-only runtime and cannot be embedded in Electron/Node in
// process, so we drive the standalone `omp` binary over its `--mode rpc` JSONL
// stdio protocol (see ompRpcClient.ts). This orchestrator honors the exact
// `StreamMessagePIFn` contract streaming.ts expects, so the `sdkBackend === 'pi'`
// branch and all three injection sites (Electron main, headless, taskRunner)
// stay unchanged — only the implementation behind them swaps.
//
// Asymmetry vs the Claude Agent SDK path: events arrive as RPC frames, not async
// iterables; approvals flow over omp's extension-UI channel (see
// ompApprovalBridge.ts), not a canUseTool wrap; auth/model are owned by omp
// itself (~/.omp/agent), so nothing is injected into process.env here.

import { existsSync } from 'node:fs'
import {
  sendChunk,
  abortControllers,
  denyPendingForConversation,
  getPISchedulerBridge,
  buildPromptWithHistory,
} from './streaming'
import type { AISettings } from './streaming'
import { getConversationPiSessionFile, setConversationPiSessionFile } from '../handlers/messages'
import { getDatabase } from '../db/database'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import type { ToolCall } from '../../shared/types'
import { findOmpBinary } from './pi/ompLocator'
import { OmpRpcClient, type OmpHostTool } from './pi/ompRpcClient'
import { buildOmpHostTools } from './pi/buildOmpHostTools'
import { createOmpSchedulerTool } from './pi/ompSchedulerTool'
import { subscribeOmpEvents, type EventAccumulator } from './pi/subscribeOmpEvents'
import { attachOmpApprovalBridge } from './pi/ompApprovalBridge'
import { createLogger, errToCtx } from '../utils/logger'

const log = createLogger('streamingOmp')

interface MessageParam {
  role: 'user' | 'assistant'
  content: string
}

export interface OmpStreamResult {
  content: string
  toolCalls: ToolCall[]
  aborted: boolean
  sessionId: string | null
  error?: string
  stopReason?: string
}

/** Map the app's `maxThinkingTokens` budget to an omp `--thinking` level. */
function mapThinkingLevel(maxThinkingTokens?: number): 'off' | 'low' | 'medium' | 'high' {
  if (!maxThinkingTokens || maxThinkingTokens === 0) return 'off'
  if (maxThinkingTokens <= 10_000) return 'low'
  if (maxThinkingTokens <= 50_000) return 'medium'
  return 'high'
}

/** Map the app's permissionMode to an omp `--approval-mode` (tier-based). */
function mapApprovalMode(permissionMode?: string): 'always-ask' | 'write' | 'yolo' {
  // omp tiers: always-ask = only reads auto-approved; write = reads+writes; yolo = all.
  switch (permissionMode) {
    case 'bypassPermissions':
      return 'yolo'
    case 'acceptEdits':
      return 'write'
    // 'default' | 'dontAsk' | 'plan' | undefined → prompt on writes/exec via the bridge.
    default:
      return 'always-ask'
  }
}

/** Extract `sessionFile` from a get_state RPC response, narrowing the untyped data. */
function extractSessionFile(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  if (!('sessionFile' in data)) return null
  const value = (data as { sessionFile: unknown }).sessionFile
  return typeof value === 'string' && value.length > 0 ? value : null
}

function tryGetDatabase(): SqlJsAdapter | null {
  try {
    return getDatabase()
  } catch {
    // DB not yet initialised (headless startup races, tests) — degrade to no persistence.
    return null
  }
}

/**
 * Stream a turn through the omp RPC subprocess backend.
 *
 * Honors the StreamMessagePIFn contract: streams via sendChunk and returns the
 * accumulated content + tool calls. `sessionId` is always null — session
 * continuity is carried by the `pi_session_file` DB column (as with the old PI
 * backend), not the return value.
 */
export async function streamMessageOmp(
  messages: MessageParam[],
  systemPrompt: string | undefined,
  aiSettings: AISettings | undefined,
  conversationId: number | undefined,
): Promise<OmpStreamResult> {
  log.debug('Using omp RPC backend', { conversationId })

  const ompPath = findOmpBinary()
  if (!ompPath) {
    const error = 'omp binary not found. Install Oh My Pi (`bun add -g @oh-my-pi/pi-coding-agent`) or set PI_OMP_PATH.'
    sendChunk('error', error, conversationId != null ? { conversationId } : {})
    return { content: '', toolCalls: [], aborted: false, sessionId: null, error }
  }

  const convKey = conversationId ?? -1
  const convExtra: Record<string, string | number> = conversationId != null ? { conversationId } : {}
  const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map<string, ToolCall>() }
  const cwd = aiSettings?.cwd || process.cwd()
  let aborted = false

  // Per-conversation abort: cancel any in-flight turn for this conversation.
  abortControllers.get(convKey)?.abort()
  const abortController = new AbortController()
  abortControllers.set(convKey, abortController)

  const db = conversationId != null ? tryGetDatabase() : null
  // Resume from a prior omp session file when present and still on disk.
  const existingSessionFile =
    db && conversationId != null ? getConversationPiSessionFile(db, conversationId) : null
  const resumeFile = existingSessionFile && existsSync(existingSessionFile) ? existingSessionFile : null

  // Assemble host tools (scheduler + MCP) before spawning so they register on start.
  const schedulerBridge = getPISchedulerBridge()
  const isUnattended = aiSettings?.requirePlanApproval === false
  const schedulerLive =
    !!schedulerBridge && !isUnattended && !!schedulerBridge.getSocketPath() && !!schedulerBridge.getAuthToken()
  const schedulerTool: OmpHostTool | null = schedulerLive ? createOmpSchedulerTool(schedulerBridge) : null

  const { hostTools, mcpHandles } = await buildOmpHostTools({
    schedulerTool,
    mcpServers: aiSettings?.mcpServers ?? {},
    convExtra,
  })

  const args: string[] = ['--approval-mode', mapApprovalMode(aiSettings?.permissionMode)]
  const thinking = mapThinkingLevel(aiSettings?.maxThinkingTokens)
  if (thinking !== 'off') args.push('--thinking', thinking)
  else args.push('--thinking', 'off')
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt)
  if (resumeFile) args.push('-r', resumeFile)
  else if (conversationId == null) args.push('--no-session')

  const client = new OmpRpcClient({
    ompPath,
    cwd,
    model: aiSettings?.model,
    args,
  })

  // Abort → tell omp to abort the turn; the prompt await unblocks via agent_end/exit.
  const onAbort = () => {
    aborted = true
    client.abort().catch(() => {})
  }
  abortController.signal.addEventListener('abort', onAbort)

  let unsubscribeEvents: (() => void) | null = null
  let unsubscribeApproval: (() => void) | null = null

  try {
    sendChunk('text', '', convExtra)
    await client.start()

    unsubscribeEvents = subscribeOmpEvents({ client, accumulator, convExtra })
    unsubscribeApproval = attachOmpApprovalBridge({ client, convKey, convExtra })

    if (hostTools.length > 0) {
      await client.setHostTools(hostTools)
    }

    // Persist the omp session file for future resume (fresh sessions only).
    if (db && conversationId != null && !resumeFile) {
      try {
        const state = await client.getState()
        const sessionFile = extractSessionFile(state.data)
        if (sessionFile) setConversationPiSessionFile(db, conversationId, sessionFile)
      } catch (err) {
        log.warn('failed to capture omp session file', errToCtx(err))
      }
    }

    // On resume, omp already holds prior history → send only the latest message.
    // Fresh session → send full history (matches the old buildPromptWithHistory).
    const promptText = resumeFile
      ? messages[messages.length - 1]?.content ?? ''
      : buildPromptWithHistory(messages)

    const agentEnd = client.waitForAgentEnd()
    await client.prompt(promptText)
    await agentEnd
  } catch (err: unknown) {
    if (aborted || (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort')))) {
      aborted = true
      sendChunk('done', undefined, { ...convExtra, stopReason: 'aborted' })
    } else {
      const errorMsg = err instanceof Error ? err.message : 'Unknown omp RPC streaming error'
      log.error('omp stream error', err)
      sendChunk('error', errorMsg, convExtra)
    }
  } finally {
    unsubscribeEvents?.()
    unsubscribeApproval?.()
    abortController.signal.removeEventListener('abort', onAbort)
    client.stop()
    await Promise.allSettled(mcpHandles.map((h) => h.close()))
    if (abortControllers.get(convKey) === abortController) {
      abortControllers.delete(convKey)
    }
    denyPendingForConversation(convKey)
  }

  if (!aborted) {
    sendChunk('done', undefined, { ...convExtra, stopReason: 'end_turn' })
  }

  return {
    content: accumulator.fullContent,
    toolCalls: Array.from(accumulator.toolCallsMap.values()),
    aborted,
    sessionId: null,
    stopReason: aborted ? 'aborted' : 'end_turn',
  }
}
