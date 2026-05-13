// PI-SDK event subscription: maps PI session events to the StreamChunk protocol.
//
// PI SDK uses session.subscribe() with a synchronous event callback. This is
// fundamentally different from the Claude Agent SDK which uses async iterables
// over ChatCompletionStreamEvents. Do NOT attempt to share event-handling logic
// between the two paths — the event shapes, approval buffering, and lifecycle
// hooks are asymmetric.

import { sendChunk } from '../streaming'
import { createLogger } from '../../utils/logger'
import type { ToolCall } from '../../../shared/types'

const log = createLogger('pi.subscribeEvents')

export interface EventAccumulator {
  fullContent: string
  toolCallsMap: Map<string, ToolCall>
}

export interface SubscribeEventsOptions {
  session: {
    subscribe(listener: (event: unknown) => void): () => void
  }
  accumulator: EventAccumulator
  convExtra: Record<string, string | number>
}

export function subscribeEvents(opts: SubscribeEventsOptions): () => void {
  const { session, accumulator, convExtra } = opts
  // PI emits thinking_start/_delta/_end as a sequence; we wrap deltas in
  // <thinking>…</thinking> inside fullContent so the renderer can split it
  // back out preserving interleaved text↔thinking order (same format as the
  // Claude SDK path in streaming.ts).
  let thinkingOpen = false
  // Both message_end and turn_end carry the same errorMessage when a provider
  // call fails — emit the error chunk only once per session.
  let emittedError = false

  return session.subscribe((event) => {
    try {
      handleEvent(event)
    } catch (err) {
      // Defensive: a thrown handler can otherwise propagate into the SDK's
      // event loop and silently break the session. Log and skip the event.
      log.error('listener threw — event will be skipped', err, {
        eventType: (event as { type?: string } | null)?.type,
      })
    }
  })

  function handleEvent(event: unknown): void {
    const ev = event as { type: string }

    if (ev.type === 'message_update') {
      const ame = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent
      if (ame?.type === 'text_delta' && ame.delta) {
        accumulator.fullContent += ame.delta
        sendChunk('text', ame.delta, convExtra)
      } else if (ame?.type === 'thinking_start') {
        if (!thinkingOpen) {
          accumulator.fullContent += '<thinking>'
          thinkingOpen = true
        }
      } else if (ame?.type === 'thinking_delta' && ame.delta) {
        if (!thinkingOpen) {
          // Defensive: some providers may skip thinking_start
          accumulator.fullContent += '<thinking>'
          thinkingOpen = true
        }
        accumulator.fullContent += ame.delta
        sendChunk('thinking', ame.delta, convExtra)
      } else if (ame?.type === 'thinking_end') {
        if (thinkingOpen) {
          accumulator.fullContent += '</thinking>\n'
          thinkingOpen = false
        }
      }
    } else if (ev.type === 'message_end' || ev.type === 'turn_end') {
      // PI signals provider errors via stopReason === 'error' + errorMessage,
      // NOT via thrown exceptions. Without this branch the failure would be
      // completely silent from the user's POV (empty assistant bubble).
      const m = (event as { message?: { role?: string; stopReason?: string; errorMessage?: string } }).message
      if (m?.role === 'assistant' && m.stopReason === 'error' && m.errorMessage) {
        // Only emit once — both message_end and turn_end carry the same message.
        if (!emittedError) {
          emittedError = true
          sendChunk('error', m.errorMessage, convExtra)
        }
      }
    } else if (ev.type === 'tool_execution_start') {
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

      accumulator.toolCallsMap.set(te.toolCallId, {
        id: te.toolCallId,
        name: te.toolName,
        input: inputJson,
        output: '',
        status: 'done',
      })
    } else if (ev.type === 'tool_execution_end') {
      const te = event as { toolCallId: string; toolName: string; result: unknown; isError: boolean }
      const output = typeof te.result === 'string' ? te.result : JSON.stringify(te.result ?? '')
      const truncated = output.slice(0, 50_000)
      const existingTool = accumulator.toolCallsMap.get(te.toolCallId)

      accumulator.toolCallsMap.set(te.toolCallId, {
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
    // agent_start, agent_end, turn_start, message_start → no-op
    // message_end / turn_end handled above for provider-error propagation.
  }
}
