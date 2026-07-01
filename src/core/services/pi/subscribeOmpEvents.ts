// Maps Oh My Pi RPC session events to the StreamChunk protocol.
//
// omp emits the SAME AgentSessionEvent shapes the in-process PI SDK did
// (message_update/assistantMessageEvent, tool_execution_start/end,
// message_end/turn_end), so this mirrors the former subscribeEvents.ts logic —
// the only difference is the source: RPC JSONL frames via OmpRpcClient.onEvent
// instead of an in-process session.subscribe callback. Because frames cross the
// RPC boundary as untyped JSON, every field is narrowed with typed guards rather
// than asserted.

import { sendChunk } from '../streaming'
import { createLogger } from '../../utils/logger'
import type { ToolCall } from '../../../shared/types'
import type { OmpRpcClient } from './ompRpcClient'

const log = createLogger('pi.subscribeOmpEvents')

export interface EventAccumulator {
  fullContent: string
  toolCallsMap: Map<string, ToolCall>
}

export interface SubscribeOmpEventsOptions {
  client: OmpRpcClient
  accumulator: EventAccumulator
  convExtra: Record<string, string | number>
}

type Frame = Record<string, unknown>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function str(frame: Frame, key: string): string | undefined {
  const v = frame[key]
  return typeof v === 'string' ? v : undefined
}

/**
 * Subscribe to an OmpRpcClient's event stream and translate frames into
 * StreamChunks, accumulating full content + tool calls. Returns an unsubscribe fn.
 */
export function subscribeOmpEvents(opts: SubscribeOmpEventsOptions): () => void {
  const { client, accumulator, convExtra } = opts
  // Thinking deltas are wrapped in <thinking>…</thinking> inside fullContent so
  // the renderer can split them back out preserving interleaved text↔thinking
  // order (same format as the Claude SDK path in streaming.ts).
  let thinkingOpen = false
  // Both message_end and turn_end carry the same errorMessage on provider
  // failure — emit the error chunk only once per turn.
  let emittedError = false

  return client.onEvent((frame) => {
    try {
      handleEvent(frame)
    } catch (err) {
      log.warn('Failed to handle omp event', { err: err instanceof Error ? err.message : String(err) })
    }
  })

  function handleEvent(frame: Frame): void {
    const type = str(frame, 'type')

    if (type === 'message_update') {
      const ame = frame.assistantMessageEvent
      if (!isRecord(ame)) return
      const ameType = str(ame, 'type')
      const delta = str(ame, 'delta')
      if (ameType === 'text_delta' && delta) {
        accumulator.fullContent += delta
        sendChunk('text', delta, convExtra)
      } else if (ameType === 'thinking_start') {
        if (!thinkingOpen) {
          accumulator.fullContent += '<thinking>'
          thinkingOpen = true
        }
      } else if (ameType === 'thinking_delta' && delta) {
        if (!thinkingOpen) {
          // Defensive: some providers may skip thinking_start.
          accumulator.fullContent += '<thinking>'
          thinkingOpen = true
        }
        accumulator.fullContent += delta
        sendChunk('thinking', delta, convExtra)
      } else if (ameType === 'thinking_end') {
        if (thinkingOpen) {
          accumulator.fullContent += '</thinking>\n'
          thinkingOpen = false
        }
      }
      return
    }

    if (type === 'message_end' || type === 'turn_end') {
      // omp signals provider errors via message.stopReason === 'error' +
      // errorMessage, NOT via a thrown exception. Without this the failure
      // is silent (empty assistant bubble).
      const message = frame.message
      if (!isRecord(message)) return
      const role = str(message, 'role')
      const stopReason = str(message, 'stopReason')
      const errorMessage = str(message, 'errorMessage')
      if (role === 'assistant' && stopReason === 'error' && errorMessage && !emittedError) {
        emittedError = true
        sendChunk('error', errorMessage, convExtra)
      }
      return
    }

    if (type === 'tool_execution_start') {
      const toolCallId = str(frame, 'toolCallId')
      const toolName = str(frame, 'toolName')
      if (!toolCallId || !toolName) return
      const inputJson = JSON.stringify(frame.args ?? {})

      sendChunk('tool_start', toolName, { toolName, toolId: toolCallId, ...convExtra })
      // omp provides args immediately — send tool_input right after tool_start.
      sendChunk('tool_input', undefined, { toolId: toolCallId, toolInput: inputJson, ...convExtra })

      accumulator.toolCallsMap.set(toolCallId, {
        id: toolCallId,
        name: toolName,
        input: inputJson,
        output: '',
        status: 'done',
      })
      return
    }

    if (type === 'tool_execution_end') {
      const toolCallId = str(frame, 'toolCallId')
      const toolName = str(frame, 'toolName')
      if (!toolCallId) return
      const rawResult = frame.result
      const isError = frame.isError === true
      const output = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult ?? '')
      const truncated = output.slice(0, 50_000)
      const existing = accumulator.toolCallsMap.get(toolCallId)

      accumulator.toolCallsMap.set(toolCallId, {
        id: toolCallId,
        name: existing?.name || toolName || '',
        input: existing?.input || '{}',
        output: truncated,
        status: isError ? 'error' : 'done',
      })

      sendChunk('tool_result', output.slice(0, 200), {
        toolName: toolName || existing?.name || '',
        toolId: toolCallId,
        toolOutput: truncated,
        toolInput: existing?.input || '{}',
        ...convExtra,
      })
      return
    }
    // agent_start, agent_end, turn_start, message_start → no-op (agent_end is the
    // turn terminator, awaited separately via client.waitForAgentEnd()).
  }
}
