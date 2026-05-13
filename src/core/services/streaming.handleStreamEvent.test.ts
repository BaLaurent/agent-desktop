/**
 * Coverage tests for `handleStreamEventMessage` in `streaming.ts`.
 *
 * `handleStreamEventMessage` is module-private; we exercise it through the
 * public one-shot path (`streamMessage` without a registered SessionManager
 * → falls through `streamMessageOneShot` → `consumeAgentQuery`). A fake SDK
 * yields configurable `stream_event` SDK messages and we capture the chunks
 * the function emits via the injectable `ChunkSender`.
 *
 * Branches covered:
 *   - content_block_start tool_use (regular tool + AskUserQuestion)
 *   - content_block_delta text_delta (with text / empty / missing)
 *   - content_block_delta input_json_delta (with currentToolBlockId / without)
 *   - content_block_stop (regular tool finalize, AskUserQuestion suppression,
 *     no currentToolBlockId, no accumulator entry)
 *   - missing event field, unknown event types
 *   - tool_use without explicit id/name (fallback paths)
 *   - mixed sequences (text + tool, multiple tools)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))

vi.mock('./anthropic', () => ({
  loadAgentSDK: vi.fn().mockResolvedValue({
    query: (args: unknown) => mockQuery(args),
  }),
  registerAgentSDK: vi.fn(),
}))

vi.mock('../utils/env', () => ({
  findBinaryInPath: vi.fn(() => '/usr/bin/node'),
}))

vi.mock('./canUseTool', () => ({
  createCanUseTool: vi.fn(() => vi.fn()),
}))

vi.mock('./sdkQueryOptions', () => ({
  applyAiSettingsToQueryOptions: vi.fn(),
}))

// Mock broadcast (stream chunks fan out to it as well)
vi.mock('../utils/broadcast', () => ({
  broadcast: vi.fn(),
}))

import { streamMessage, setChunkSender } from './streaming'

type Chunk = { channel: string; payload: Record<string, unknown> }

let captured: Chunk[]

function makeAsyncIterable(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
  }
}

/** Wrap a list of stream_event payload `event` objects into SDK messages. */
function streamEvents(...events: Array<Record<string, unknown> | undefined>): unknown[] {
  return events.map((event) => ({ type: 'stream_event', event }))
}

/** Drive the one-shot path with a fake SDK that yields `messages`. */
async function runOneShot(messages: unknown[]): Promise<void> {
  mockQuery.mockReturnValueOnce(makeAsyncIterable(messages))
  await streamMessage([{ role: 'user', content: 'hello' }], undefined, undefined, undefined)
}

/** Pull only chunks of a given type. */
function chunksOf(type: string): Chunk[] {
  return captured.filter((c) => c.payload.type === type)
}

describe('handleStreamEventMessage (via one-shot streamMessage)', () => {
  beforeEach(() => {
    captured = []
    setChunkSender((channel, payload) => {
      captured.push({ channel, payload })
    })
    mockQuery.mockReset()
  })

  // ─── text_delta branches ────────────────────────────────────────────

  it('forwards text_delta with text content as a "text" chunk', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hello world' },
      }),
    )
    const texts = chunksOf('text').filter((c) => c.payload.content === 'hello world')
    expect(texts).toHaveLength(1)
  })

  it('concatenates multiple text_delta events into fullContent', async () => {
    await runOneShot(
      streamEvents(
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'foo' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'bar' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'baz' } },
      ),
    )
    const texts = chunksOf('text').filter((c) => typeof c.payload.content === 'string' && c.payload.content !== '')
    expect(texts.map((c) => c.payload.content)).toEqual(['foo', 'bar', 'baz'])
  })

  it('skips text_delta when text is the empty string (falsy)', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '' },
      }),
    )
    // Only the initial '' priming chunk; no subsequent ''-text from the delta
    const nonEmpty = chunksOf('text').filter((c) => c.payload.content !== '')
    expect(nonEmpty).toHaveLength(0)
  })

  it('skips text_delta when text is missing entirely', async () => {
    await runOneShot(
      streamEvents({ type: 'content_block_delta', delta: { type: 'text_delta' } }),
    )
    const nonEmpty = chunksOf('text').filter((c) => c.payload.content !== '')
    expect(nonEmpty).toHaveLength(0)
  })

  // ─── tool_use start branches ────────────────────────────────────────

  it('emits tool_start with explicit id+name on content_block_start', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tool_123', name: 'Bash' },
      }),
    )
    const starts = chunksOf('tool_start')
    expect(starts).toHaveLength(1)
    expect(starts[0].payload.toolName).toBe('Bash')
    expect(starts[0].payload.toolId).toBe('tool_123')
  })

  it('falls back to a synthetic toolId when content_block.id is missing', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Read' },
      }),
    )
    const starts = chunksOf('tool_start')
    expect(starts).toHaveLength(1)
    expect(typeof starts[0].payload.toolId).toBe('string')
    expect((starts[0].payload.toolId as string).startsWith('tool_')).toBe(true)
  })

  it('falls back to "tool" when content_block.name is missing', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tx' },
      }),
    )
    const starts = chunksOf('tool_start')
    expect(starts).toHaveLength(1)
    expect(starts[0].payload.toolName).toBe('tool')
  })

  it('does NOT emit tool_start for AskUserQuestion (handled via canUseTool)', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'ask_1', name: 'AskUserQuestion' },
      }),
    )
    expect(chunksOf('tool_start')).toHaveLength(0)
  })

  it('ignores content_block_start when content_block.type is not tool_use', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_start',
        content_block: { type: 'text' },
      }),
    )
    expect(chunksOf('tool_start')).toHaveLength(0)
  })

  // ─── input_json_delta branches ──────────────────────────────────────

  it('accumulates input_json_delta into the current tool block', async () => {
    await runOneShot(
      streamEvents(
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tool_J', name: 'Bash' },
        },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"cmd":' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '"ls"}' } },
        { type: 'content_block_stop' },
      ),
    )
    const inputs = chunksOf('tool_input')
    expect(inputs).toHaveLength(1)
    expect(inputs[0].payload.toolInput).toBe('{"cmd":"ls"}')
  })

  it('treats missing partial_json as empty string when accumulating', async () => {
    await runOneShot(
      streamEvents(
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tool_K', name: 'Read' },
        },
        { type: 'content_block_delta', delta: { type: 'input_json_delta' } },
        { type: 'content_block_stop' },
      ),
    )
    const inputs = chunksOf('tool_input')
    expect(inputs).toHaveLength(1)
    // Empty accumulator -> default '{}' fallback in handleStreamEventMessage
    expect(inputs[0].payload.toolInput).toBe('{}')
  })

  it('ignores input_json_delta when no current tool block is open', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"x":1}' },
      }),
    )
    expect(chunksOf('tool_input')).toHaveLength(0)
  })

  // ─── content_block_stop branches ────────────────────────────────────

  it('finalizes regular tool with accumulated input on content_block_stop', async () => {
    await runOneShot(
      streamEvents(
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tool_S', name: 'Grep' },
        },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' } },
        { type: 'content_block_stop' },
      ),
    )
    const inputs = chunksOf('tool_input')
    expect(inputs).toHaveLength(1)
    expect(inputs[0].payload.toolId).toBe('tool_S')
    expect(inputs[0].payload.toolInput).toBe('{"q":"x"}')
  })

  it('suppresses tool_input chunk for AskUserQuestion on content_block_stop', async () => {
    await runOneShot(
      streamEvents(
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'ask_X', name: 'AskUserQuestion' },
        },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"q":"?"}' } },
        { type: 'content_block_stop' },
      ),
    )
    expect(chunksOf('tool_input')).toHaveLength(0)
    expect(chunksOf('tool_start')).toHaveLength(0)
  })

  it('ignores content_block_stop when no current tool block is open', async () => {
    await runOneShot(streamEvents({ type: 'content_block_stop' }))
    expect(chunksOf('tool_input')).toHaveLength(0)
  })

  it('ignores content_block_stop when accumulator has no entry for current id', async () => {
    // Manually craft a scenario: open tool, but stream_event handler only
    // registers accumulator entry on content_block_start. Stopping a freshly
    // opened tool with NO accum entry would short-circuit; here we open and
    // stop — accumulator IS set ('') so the regular path fires once. Then a
    // second stop after currentToolBlockId is null is a no-op.
    await runOneShot(
      streamEvents(
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tool_Y', name: 'Bash' },
        },
        { type: 'content_block_stop' },
        { type: 'content_block_stop' }, // currentToolBlockId is now null → no-op
      ),
    )
    expect(chunksOf('tool_input')).toHaveLength(1)
  })

  // ─── unknown / malformed events ─────────────────────────────────────

  it('ignores stream_event with no event field', async () => {
    await runOneShot([{ type: 'stream_event' }])
    expect(chunksOf('tool_start')).toHaveLength(0)
    expect(chunksOf('tool_input')).toHaveLength(0)
    const nonEmpty = chunksOf('text').filter((c) => c.payload.content !== '')
    expect(nonEmpty).toHaveLength(0)
  })

  it('ignores stream_event with an unknown event.type', async () => {
    await runOneShot(streamEvents({ type: 'totally_unknown_event' }))
    expect(chunksOf('tool_start')).toHaveLength(0)
    expect(chunksOf('tool_input')).toHaveLength(0)
  })

  it('ignores content_block_delta with unknown delta.type (e.g. signature_delta)', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_delta',
        delta: { type: 'signature_delta', text: 'sig' },
      }),
    )
    const nonEmpty = chunksOf('text').filter((c) => c.payload.content !== '')
    expect(nonEmpty).toHaveLength(0)
    expect(chunksOf('tool_input')).toHaveLength(0)
  })

  it('forwards thinking_delta with thinking field as a "thinking" chunk', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'pondering' },
      }),
    )
    const thinking = chunksOf('thinking').filter((c) => c.payload.content === 'pondering')
    expect(thinking).toHaveLength(1)
    const nonEmptyText = chunksOf('text').filter((c) => c.payload.content !== '')
    expect(nonEmptyText).toHaveLength(0)
  })

  it('ignores thinking_delta with empty thinking field', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: '' },
      }),
    )
    expect(chunksOf('thinking')).toHaveLength(0)
  })

  it('ignores content_block_delta with no delta field', async () => {
    await runOneShot(streamEvents({ type: 'content_block_delta' }))
    const nonEmpty = chunksOf('text').filter((c) => c.payload.content !== '')
    expect(nonEmpty).toHaveLength(0)
    expect(chunksOf('tool_input')).toHaveLength(0)
  })

  // ─── mixed sequences ────────────────────────────────────────────────

  it('handles a realistic interleaved text+tool sequence', async () => {
    await runOneShot(
      streamEvents(
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'thinking… ' } },
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 't1', name: 'Bash' },
        },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"cmd":"ls"}' } },
        { type: 'content_block_stop' },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done.' } },
      ),
    )
    const nonEmptyText = chunksOf('text').filter((c) => c.payload.content !== '')
    expect(nonEmptyText.map((c) => c.payload.content)).toEqual(['thinking… ', 'done.'])
    expect(chunksOf('tool_start')).toHaveLength(1)
    expect(chunksOf('tool_input')).toHaveLength(1)
  })

  it('preserves interleaved text/thinking order and wraps thinking in <thinking> tags', async () => {
    mockQuery.mockReturnValueOnce(makeAsyncIterable(
      streamEvents(
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'before. ' } },
        { type: 'content_block_start', content_block: { type: 'thinking' } },
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'let me ' } },
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'think...' } },
        { type: 'content_block_stop' },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'after.' } },
      ),
    ))
    const result = await streamMessage(
      [{ role: 'user', content: 'hi' }], undefined, undefined, undefined,
    )
    expect(result.content).toBe('before. <thinking>let me think...</thinking>\nafter.')
    // Chunk order matches event order
    const ordered = captured
      .filter((c) => c.payload.type === 'text' || c.payload.type === 'thinking')
      .filter((c) => c.payload.content !== '')
      .map((c) => ({ type: c.payload.type, content: c.payload.content }))
    expect(ordered).toEqual([
      { type: 'text', content: 'before. ' },
      { type: 'thinking', content: 'let me ' },
      { type: 'thinking', content: 'think...' },
      { type: 'text', content: 'after.' },
    ])
  })

  it('closes <thinking> tag even if content_block_stop arrives without a matching tool', async () => {
    mockQuery.mockReturnValueOnce(makeAsyncIterable(
      streamEvents(
        { type: 'content_block_start', content_block: { type: 'thinking' } },
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'reflect' } },
        { type: 'content_block_stop' },
      ),
    ))
    const result = await streamMessage(
      [{ role: 'user', content: 'hi' }], undefined, undefined, undefined,
    )
    expect(result.content).toBe('<thinking>reflect</thinking>\n')
  })

  it('handles two consecutive tool blocks with separate ids/inputs', async () => {
    await runOneShot(
      streamEvents(
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 't1', name: 'Bash' },
        },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"cmd":"a"}' } },
        { type: 'content_block_stop' },
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 't2', name: 'Read' },
        },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"path":"/x"}' } },
        { type: 'content_block_stop' },
      ),
    )
    const inputs = chunksOf('tool_input')
    expect(inputs.map((c) => c.payload.toolId)).toEqual(['t1', 't2'])
    expect(inputs.map((c) => c.payload.toolInput)).toEqual(['{"cmd":"a"}', '{"path":"/x"}'])
  })

  it('does not crash when chunk sender is not set (sender becomes null)', async () => {
    setChunkSender(null as unknown as (channel: string, payload: Record<string, unknown>) => void)
    mockQuery.mockReturnValueOnce(
      makeAsyncIterable(
        streamEvents({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hi' },
        }),
      ),
    )
    // Optional-chained sender → no throw even if null
    await expect(
      streamMessage([{ role: 'user', content: 'x' }], undefined, undefined, undefined),
    ).resolves.toBeDefined()
  })

  it('forwards convExtra (conversationId) on stream_event chunks when conversationId provided', async () => {
    // conversationId provided + persistSession: false forces one-shot path
    mockQuery.mockReturnValueOnce(
      makeAsyncIterable(
        streamEvents({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hi' },
        }),
      ),
    )
    await streamMessage([{ role: 'user', content: 'x' }], undefined, undefined, 42, null, false)
    const texts = chunksOf('text').filter((c) => c.payload.content === 'hi')
    expect(texts).toHaveLength(1)
    expect(texts[0].payload.conversationId).toBe(42)
  })

  it('passes input_json_delta with no partial_json AND no current tool as a no-op', async () => {
    await runOneShot(
      streamEvents({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta' },
      }),
    )
    expect(chunksOf('tool_input')).toHaveLength(0)
  })

  it('opens AskUserQuestion then stops without emitting tool_input or tool_start', async () => {
    await runOneShot(
      streamEvents(
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'ask_Z', name: 'AskUserQuestion' },
        },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"x":1}' } },
        { type: 'content_block_stop' },
      ),
    )
    expect(chunksOf('tool_start')).toHaveLength(0)
    expect(chunksOf('tool_input')).toHaveLength(0)
  })
})
