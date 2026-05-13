import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock sendChunk so assertions can inspect emitted chunks
const mockSendChunk = vi.fn()
vi.mock('../streaming', async () => {
  const actual = await vi.importActual<typeof import('../streaming')>('../streaming')
  return { ...actual, sendChunk: (...args: unknown[]) => mockSendChunk(...args) }
})

import { subscribeEvents, type EventAccumulator } from './subscribeEvents'

function makeAccumulator(): EventAccumulator {
  return { fullContent: '', toolCallsMap: new Map() }
}

function makeSession() {
  let listener: ((event: unknown) => void) | null = null
  const unsubscribe = vi.fn()
  return {
    subscribe: vi.fn((fn: (event: unknown) => void) => {
      listener = fn
      return unsubscribe
    }),
    emit(event: unknown) {
      listener?.(event)
    },
    unsubscribe,
  }
}

const convExtra = { conversationId: 7 }

describe('subscribeEvents — subscribe / unsubscribe', () => {
  beforeEach(() => mockSendChunk.mockClear())

  it('calls session.subscribe and returns the unsubscribe fn', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    const unsub = subscribeEvents({ session, accumulator: acc, convExtra })
    expect(session.subscribe).toHaveBeenCalledOnce()
    expect(typeof unsub).toBe('function')
    // The returned fn IS the unsubscribe returned by session.subscribe
    unsub()
    expect(session.unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('subscribeEvents — message_update / text_delta', () => {
  beforeEach(() => mockSendChunk.mockClear())

  it('appends delta to fullContent and emits text chunk', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    })
    expect(acc.fullContent).toBe('Hello')
    expect(mockSendChunk).toHaveBeenCalledWith('text', 'Hello', convExtra)
  })

  it('accumulates multiple deltas', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Foo' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Bar' } })
    expect(acc.fullContent).toBe('FooBar')
    expect(mockSendChunk).toHaveBeenCalledTimes(2)
  })

  it('does NOT emit for text_delta with empty delta', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '' } })
    expect(mockSendChunk).not.toHaveBeenCalled()
    expect(acc.fullContent).toBe('')
  })

  it('does NOT emit for message_update with no assistantMessageEvent', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'message_update' })
    expect(mockSendChunk).not.toHaveBeenCalled()
  })

  it('does NOT emit for message_update with non-text_delta event type', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'other_event', delta: 'x' } })
    expect(mockSendChunk).not.toHaveBeenCalled()
  })
})

describe('subscribeEvents — thinking events', () => {
  beforeEach(() => mockSendChunk.mockClear())

  it('wraps thinking_start/_delta/_end as <thinking>…</thinking> in fullContent and emits thinking chunks', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'let me ' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'think' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } })
    expect(acc.fullContent).toBe('<thinking>let me think</thinking>\n')
    const thinkingCalls = mockSendChunk.mock.calls.filter((c) => c[0] === 'thinking')
    expect(thinkingCalls.map((c) => c[1])).toEqual(['let me ', 'think'])
  })

  it('preserves interleaved text/thinking order in fullContent', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'before. ' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'after.' } })
    expect(acc.fullContent).toBe('before. <thinking>hmm</thinking>\nafter.')
  })

  it('opens <thinking> defensively when thinking_delta arrives before thinking_start', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'orphan' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } })
    expect(acc.fullContent).toBe('<thinking>orphan</thinking>\n')
  })

  it('does NOT emit chunk for empty thinking_delta', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } })
    session.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '' } })
    const thinkingCalls = mockSendChunk.mock.calls.filter((c) => c[0] === 'thinking')
    expect(thinkingCalls).toHaveLength(0)
  })
})

describe('subscribeEvents — tool_execution_start', () => {
  beforeEach(() => mockSendChunk.mockClear())

  it('emits tool_start then tool_input chunks', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'read_file', args: { path: '/tmp' } })
    const calls = mockSendChunk.mock.calls
    expect(calls[0][0]).toBe('tool_start')
    expect(calls[0][1]).toBe('read_file')
    expect(calls[1][0]).toBe('tool_input')
    expect(calls[1][2]).toMatchObject({ toolId: 'tc-1', toolInput: JSON.stringify({ path: '/tmp' }) })
  })

  it('stores tool call in toolCallsMap with status done', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'tool_execution_start', toolCallId: 'tc-2', toolName: 'write_file', args: {} })
    const entry = acc.toolCallsMap.get('tc-2')
    expect(entry).toBeDefined()
    expect(entry!.name).toBe('write_file')
    expect(entry!.status).toBe('done')
    expect(entry!.input).toBe('{}')
  })

  it('serializes null args as "{}"', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'tool_execution_start', toolCallId: 'tc-3', toolName: 'ls', args: null })
    const entry = acc.toolCallsMap.get('tc-3')
    expect(entry!.input).toBe('{}')
  })
})

describe('subscribeEvents — tool_execution_end', () => {
  beforeEach(() => mockSendChunk.mockClear())

  it('emits tool_result and updates toolCallsMap output', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    // First start
    session.emit({ type: 'tool_execution_start', toolCallId: 'tc-4', toolName: 'read', args: {} })
    mockSendChunk.mockClear()
    session.emit({ type: 'tool_execution_end', toolCallId: 'tc-4', toolName: 'read', result: 'file contents', isError: false })
    expect(mockSendChunk).toHaveBeenCalledWith('tool_result', expect.any(String), expect.objectContaining({ toolId: 'tc-4' }))
    const entry = acc.toolCallsMap.get('tc-4')
    expect(entry!.output).toBe('file contents')
    expect(entry!.status).toBe('done')
  })

  it('sets status error when isError is true', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'tool_execution_start', toolCallId: 'tc-5', toolName: 'bad', args: {} })
    session.emit({ type: 'tool_execution_end', toolCallId: 'tc-5', toolName: 'bad', result: 'boom', isError: true })
    expect(acc.toolCallsMap.get('tc-5')!.status).toBe('error')
  })

  it('JSON-stringifies non-string result', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'tool_execution_start', toolCallId: 'tc-6', toolName: 't', args: {} })
    session.emit({ type: 'tool_execution_end', toolCallId: 'tc-6', toolName: 't', result: { key: 'val' }, isError: false })
    const entry = acc.toolCallsMap.get('tc-6')
    expect(entry!.output).toBe(JSON.stringify({ key: 'val' }))
  })

  it('truncates output to 50_000 chars', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    const longResult = 'x'.repeat(60_000)
    session.emit({ type: 'tool_execution_start', toolCallId: 'tc-7', toolName: 't', args: {} })
    session.emit({ type: 'tool_execution_end', toolCallId: 'tc-7', toolName: 't', result: longResult, isError: false })
    const entry = acc.toolCallsMap.get('tc-7')
    expect(entry!.output.length).toBe(50_000)
  })

  it('falls back to event toolName when toolCallsMap has no prior entry', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    // No start event — simulate end-only
    session.emit({ type: 'tool_execution_end', toolCallId: 'tc-8', toolName: 'fallback_tool', result: 'ok', isError: false })
    const entry = acc.toolCallsMap.get('tc-8')
    expect(entry!.name).toBe('fallback_tool')
  })
})

describe('subscribeEvents — unknown event types', () => {
  beforeEach(() => mockSendChunk.mockClear())

  it('silently ignores agent_start', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'agent_start' })
    expect(mockSendChunk).not.toHaveBeenCalled()
    expect(acc.fullContent).toBe('')
  })

  it('silently ignores turn_end', () => {
    const session = makeSession()
    const acc = makeAccumulator()
    subscribeEvents({ session, accumulator: acc, convExtra })
    session.emit({ type: 'turn_end' })
    expect(mockSendChunk).not.toHaveBeenCalled()
  })
})
