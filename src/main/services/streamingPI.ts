import { sendChunk, buildPromptWithHistory, abortControllers } from './streaming'
import { loadPISdk } from './piSdk'
import type { AISettings } from './streaming'
import type { ToolCall } from '../../shared/types'

interface MessageParam {
  role: 'user' | 'assistant'
  content: string
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
): Promise<{ content: string; toolCalls: ToolCall[]; aborted: boolean; sessionId: string | null }> {
  console.log(`[streamingPI] Using PI-SDK backend for conversation ${conversationId}`)
  const pi = await loadPISdk()

  const convKey = conversationId ?? -1
  const convExtra = conversationId != null ? { conversationId } : {}

  let fullContent = ''
  let aborted = false
  const toolCallsMap = new Map<string, ToolCall>()

  // Abort any existing stream for this conversation before starting new one
  const existing = abortControllers.get(convKey)
  if (existing) existing.abort()

  const abortController = new AbortController()
  abortControllers.set(convKey, abortController)

  try {
    sendChunk('text', '', convExtra)

    const thinkingLevel = mapThinkingLevel(aiSettings?.maxThinkingTokens)

    const { session } = await pi.createAgentSession({
      cwd: aiSettings?.cwd || process.cwd(),
      sessionManager: pi.SessionManager.inMemory(),
      thinkingLevel,
      tools: pi.codingTools,
    })

    // Wire abort: when our abort controller fires, abort the PI session
    const onAbort = () => {
      session.abort().catch(() => {})
    }
    abortController.signal.addEventListener('abort', onAbort)

    // Subscribe to events and map to StreamChunk protocol
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_update') {
        const ame = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent
        if (ame?.type === 'text_delta' && ame.delta) {
          fullContent += ame.delta
          sendChunk('text', ame.delta, convExtra)
        }
      } else if (event.type === 'tool_execution_start') {
        const te = event as { toolCallId: string; toolName: string; args: unknown }
        const inputJson = JSON.stringify(te.args || {})

        sendChunk('tool_start', te.toolName, {
          toolName: te.toolName,
          toolId: te.toolCallId,
          ...convExtra,
        })

        // PI provides args immediately — send tool_input right after tool_start
        sendChunk('tool_input', undefined, {
          toolId: te.toolCallId,
          toolInput: inputJson,
          ...convExtra,
        })

        toolCallsMap.set(te.toolCallId, {
          id: te.toolCallId,
          name: te.toolName,
          input: inputJson,
          output: '',
          status: 'done',
        })
      } else if (event.type === 'tool_execution_end') {
        const te = event as { toolCallId: string; toolName: string; result: unknown; isError: boolean }
        const output = typeof te.result === 'string' ? te.result : JSON.stringify(te.result ?? '')
        const truncated = output.slice(0, 50_000)
        const existingTool = toolCallsMap.get(te.toolCallId)

        toolCallsMap.set(te.toolCallId, {
          id: te.toolCallId,
          name: existingTool?.name || te.toolName,
          input: existingTool?.input || '{}',
          output: truncated,
          status: te.isError ? 'error' : 'done',
        })

        sendChunk('tool_result', output.slice(0, 200), {
          toolName: te.toolName,
          toolId: te.toolCallId,
          toolOutput: truncated,
          toolInput: existingTool?.input || '{}',
          ...convExtra,
        })
      }
      // agent_start, agent_end, turn_start, turn_end, message_start, message_end → no-op
    })

    // Build prompt: inject system prompt as context prefix since PI session
    // uses its own system prompt mechanism via ResourceLoader
    const historyPrompt = buildPromptWithHistory(messages)
    const fullPrompt = systemPrompt
      ? `<system_context>\n${systemPrompt}\n</system_context>\n\n${historyPrompt}`
      : historyPrompt

    try {
      await session.prompt(fullPrompt)
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
    }

    sendChunk('done', undefined, {
      ...convExtra,
      ...(aborted ? { stopReason: 'aborted' } : { stopReason: 'end_turn' }),
    })
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
      aborted = true
      sendChunk('done', undefined, { ...convExtra, stopReason: 'aborted' })
    } else {
      const errorMsg = err instanceof Error ? err.message : 'Unknown PI-SDK streaming error'
      console.error('[streamingPI] Error:', err)
      sendChunk('error', errorMsg, convExtra)
    }
  } finally {
    // Only delete if this is still our controller
    if (abortControllers.get(convKey) === abortController) {
      abortControllers.delete(convKey)
    }
  }

  return { content: fullContent, toolCalls: Array.from(toolCallsMap.values()), aborted, sessionId: null }
}
