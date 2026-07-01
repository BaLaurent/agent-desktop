/**
 * Coverage for `subscribeOmpEvents`: mapping omp RPC AgentSessionEvent frames
 * (delivered via OmpRpcClient.onEvent) into StreamChunks + EventAccumulator
 * mutations. The transport (OmpRpcClient) is mocked at the `onEvent`
 * boundary — no real subprocess is involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendChunk } = vi.hoisted(() => ({ sendChunk: vi.fn() }))

vi.mock('../streaming', () => ({ sendChunk }))

import { subscribeOmpEvents, type EventAccumulator } from './subscribeOmpEvents'
import type { OmpRpcClient } from './ompRpcClient'

type Frame = Record<string, unknown>
type FrameListener = (frame: Frame) => void

function makeClient(): { client: OmpRpcClient; emit: FrameListener; unsubscribed: () => boolean } {
  let captured: FrameListener = () => {}
  let unsubscribed = false
  const fake = {
    onEvent(fn: FrameListener) {
      captured = fn
      return () => {
        unsubscribed = true
      }
    },
  }
  return {
    client: fake as unknown as OmpRpcClient,
    emit: (frame) => captured(frame),
    unsubscribed: () => unsubscribed,
  }
}

beforeEach(() => {
  sendChunk.mockReset()
})

describe('subscribeOmpEvents', () => {
  it('text_delta appends to fullContent and emits a text chunk', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello' } })

    expect(accumulator.fullContent).toContain('hello')
    expect(sendChunk).toHaveBeenCalledWith('text', 'hello', {})
  })

  it('command_output (local slash command) emits a text chunk and accumulates into fullContent', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'command_output', text: '* read\n* bash\n* edit' })

    expect(sendChunk).toHaveBeenCalledWith('text', '* read\n* bash\n* edit', {})
    expect(accumulator.fullContent).toBe('* read\n* bash\n* edit')
  })

  it('command_output with no text is a no-op', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'command_output' })

    expect(sendChunk).not.toHaveBeenCalled()
    expect(accumulator.fullContent).toBe('')
  })

  it('wraps a thinking_start/delta/end sequence in <thinking> tags and emits exactly one thinking chunk', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } })
    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'reasoning' } })
    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } })

    expect(accumulator.fullContent).toContain('<thinking>reasoning</thinking>')
    expect(sendChunk).toHaveBeenCalledWith('thinking', 'reasoning', {})
    expect(sendChunk.mock.calls.filter((c) => c[0] === 'thinking')).toHaveLength(1)
  })

  it('defensively opens a <thinking> tag if thinking_delta arrives without a prior thinking_start', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'oops' } })
    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } })

    expect(accumulator.fullContent).toBe('<thinking>oops</thinking>\n')
  })

  it('tool_execution_start emits tool_start then tool_input and records a pending tool call', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'write', args: { path: 'a' } })

    expect(sendChunk).toHaveBeenNthCalledWith(1, 'tool_start', 'write', { toolName: 'write', toolId: 't1' })
    expect(sendChunk).toHaveBeenNthCalledWith(2, 'tool_input', undefined, {
      toolId: 't1',
      toolInput: JSON.stringify({ path: 'a' }),
    })
    expect(accumulator.toolCallsMap.has('t1')).toBe(true)
    expect(accumulator.toolCallsMap.get('t1')?.name).toBe('write')
    expect(accumulator.toolCallsMap.get('t1')?.input).toBe(JSON.stringify({ path: 'a' }))
  })

  it('tool_execution_end marks the call done, captures output, and emits tool_result with prior input', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'write', args: { path: 'a' } })
    sendChunk.mockClear()
    emit({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'write', result: 'ok', isError: false })

    expect(sendChunk).toHaveBeenCalledWith(
      'tool_result',
      'ok',
      expect.objectContaining({
        toolName: 'write',
        toolId: 't1',
        toolOutput: 'ok',
        toolInput: JSON.stringify({ path: 'a' }),
      }),
    )
    const call = accumulator.toolCallsMap.get('t1')
    expect(call?.status).toBe('done')
    expect(call?.output).toBe('ok')
  })

  it('tool_execution_end with isError=true marks the call as error status', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: {} })
    emit({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: 'exit 1', isError: true })

    expect(accumulator.toolCallsMap.get('t1')?.status).toBe('error')
  })

  it('tool_execution_end without a prior start falls back to the frame toolName and empty input', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'tool_execution_end', toolCallId: 't9', toolName: 'orphan', result: 'done', isError: false })

    const call = accumulator.toolCallsMap.get('t9')
    expect(call?.name).toBe('orphan')
    expect(call?.input).toBe('{}')
    expect(call?.output).toBe('done')
  })

  it('emits an error chunk exactly once even when message_end and turn_end both carry the same error', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    const message = { role: 'assistant', stopReason: 'error', errorMessage: 'boom' }
    emit({ type: 'message_end', message })
    emit({ type: 'turn_end', message })

    const calls = sendChunk.mock.calls.filter((c) => c[0] === 'error')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['error', 'boom', {}])
  })

  it.each([
    ['non-assistant role', { role: 'user', stopReason: 'error', errorMessage: 'boom' }],
    ['non-error stopReason', { role: 'assistant', stopReason: 'end_turn', errorMessage: 'boom' }],
    ['missing errorMessage', { role: 'assistant', stopReason: 'error' }],
  ])('does not emit an error chunk for %s', (_label, message) => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    emit({ type: 'message_end', message })

    expect(sendChunk.mock.calls.filter((c) => c[0] === 'error')).toHaveLength(0)
  })

  it('swallows a handler failure (e.g. non-serializable tool args) without breaking later frames', () => {
    const { client, emit } = makeClient()
    const accumulator: EventAccumulator = { fullContent: '', toolCallsMap: new Map() }
    subscribeOmpEvents({ client, accumulator, convExtra: {} })

    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() =>
      emit({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'write', args: circular }),
    ).not.toThrow()
    expect(sendChunk).not.toHaveBeenCalled()

    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'still alive' } })
    expect(sendChunk).toHaveBeenCalledWith('text', 'still alive', {})
  })

  it('returns an unsubscribe function that delegates to the client onEvent unsubscribe', () => {
    const { client, emit, unsubscribed } = makeClient()
    const unsub = subscribeOmpEvents({ client, accumulator: { fullContent: '', toolCallsMap: new Map() }, convExtra: {} })

    expect(unsubscribed()).toBe(false)
    unsub()
    expect(unsubscribed()).toBe(true)
    // sanity: emit is still callable post-unsub (fake client doesn't enforce removal),
    // proving unsub() itself didn't throw or break the captured listener reference.
    expect(() => emit({ type: 'agent_start' })).not.toThrow()
  })
})
