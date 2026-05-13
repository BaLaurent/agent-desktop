// PI-SDK session runner: create, bind, wire abort, prompt, and dispose.
//
// Isolates the session lifecycle (createAgentSession, bindExtensions, abort
// wiring, subscribe/prompt/dispose) so the orchestrator stays linear.

import { sendChunk, getPIUIWindowProvider } from '../streaming'
import { PiUIContext } from '../piUIContext'
import { registerPiUIContext, unregisterPiUIContext } from '../piUIRegistry'
import { subscribeEvents } from './subscribeEvents'
import { buildPrompt } from './buildPrompt'
import type { ToolCall } from '../../../shared/types'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { createLogger } from '../../utils/logger'

const log = createLogger('runSession')

interface RunSessionOptions {
  pi: {
    createAgentSession(opts: Record<string, unknown>): Promise<{ session: PiSession }>
  }
  cwd: string
  sessionManager: unknown
  thinkingLevel: 'off' | 'low' | 'medium' | 'high'
  tools: unknown[]
  customTools: ToolDefinition[]
  resourceLoader: { reload(): Promise<void> }
  persistAfterCreate(): void
  abortController: AbortController
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  systemPrompt: string | undefined
  convKey: number
  convExtra: Record<string, string | number>
  accumulator: { fullContent: string; toolCallsMap: Map<string, ToolCall> }
  /** Resolved PI Model<any> object (NOT a string id). The SDK silently
   *  ignores string ids and falls back to its default model, which surfaces
   *  as misleading "no API key" / "OAuth forbidden" errors. Resolve via
   *  resolveModel.ts before calling runSession. Undefined = use SDK default. */
  model?: unknown
}

interface PiSession {
  subscribe(listener: (event: unknown) => void): () => void
  prompt(text: string): Promise<void>
  abort(): Promise<void>
  dispose(): void
  bindExtensions(opts: Record<string, unknown>): Promise<void>
}

/** Returns true if the session was aborted. Throws on non-abort errors. */
export async function runSession(opts: RunSessionOptions): Promise<boolean> {
  const {
    pi,
    cwd,
    sessionManager,
    thinkingLevel,
    tools,
    customTools,
    resourceLoader,
    persistAfterCreate,
    abortController,
    messages,
    systemPrompt,
    convKey,
    convExtra,
    accumulator,
    model,
  } = opts

  const { session } = await pi.createAgentSession({
    cwd,
    sessionManager,
    thinkingLevel,
    tools,
    customTools,
    resourceLoader,
    // Only forward when explicitly set — keeps PI's "first available" fallback intact.
    ...(model ? { model } : {}),
  } as Record<string, unknown>)
  persistAfterCreate()

  const winProvider = getPIUIWindowProvider()
  const win = winProvider?.() ?? null
  const uiContext = new PiUIContext(
    win ?? { webContents: { send: () => {} }, isDestroyed: () => true },
    convKey,
  )
  registerPiUIContext(convKey, uiContext)

  try {
    await session.bindExtensions({ uiContext: uiContext as never })
  } catch {
    log.debug('bindExtensions not available (PI SDK version may not support it)')
  }

  const onAbort = () => {
    session.abort().catch(() => {})
  }
  abortController.signal.addEventListener('abort', onAbort)

  const unsubscribe = subscribeEvents({ session, accumulator, convExtra })
  const promptText = buildPrompt(messages, systemPrompt)
  let aborted = false

  try {
    await session.prompt(promptText)
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
      aborted = true
    } else {
      throw err
    }
  } finally {
    unsubscribe()
    abortController.signal.removeEventListener('abort', onAbort)
    session.dispose()
    uiContext.dispose()
    unregisterPiUIContext(convKey)
  }

  sendChunk('done', undefined, {
    ...convExtra,
    stopReason: aborted ? 'aborted' : 'end_turn',
  })

  return aborted
}
