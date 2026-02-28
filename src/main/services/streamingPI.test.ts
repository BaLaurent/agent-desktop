import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendFn = vi.fn()
vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => ({
    isDestroyed: () => false,
    webContents: { send: (...args: unknown[]) => mockSendFn(...args) },
  })),
}))

const mockDispose = vi.fn()
vi.mock('./piUIContext', () => {
  return {
    PiUIContext: function PiUIContext() {
      this.dispose = mockDispose
      this.handleResponse = vi.fn()
    },
  }
})

vi.mock('./piExtensions', () => ({
  registerPiUIContext: vi.fn(),
  unregisterPiUIContext: vi.fn(),
  discoverPIExtensions: vi.fn(),
  registerHandlers: vi.fn(),
}))

// Mock session object
const mockSession = {
  subscribe: vi.fn(),
  prompt: vi.fn(),
  abort: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
  bindExtensions: vi.fn().mockResolvedValue(undefined),
}

const mockCreateAgentSession = vi.fn().mockResolvedValue({
  session: mockSession,
  extensionsResult: {},
})

// vi.mock is hoisted — use globalThis to share state between factory and tests
vi.mock('./piSdk', () => {
  // Must be defined inside factory — vi.mock is hoisted
  const _mockReload = vi.fn().mockResolvedValue(undefined)
  const _mockGetExtensions = vi.fn().mockReturnValue({ extensions: [] })
  return {
    loadPISdk: vi.fn().mockResolvedValue({
      createAgentSession: (...args: unknown[]) => mockCreateAgentSession(...args),
      SessionManager: { inMemory: vi.fn().mockReturnValue({}) },
      DefaultResourceLoader: function DefaultResourceLoader(opts: Record<string, unknown>) {
        ;(globalThis as Record<string, unknown>).__lastResourceLoaderOpts = opts
        return { reload: _mockReload, getExtensions: _mockGetExtensions }
      },
      codingTools: [],
    }),
  }
})

import { streamMessagePI } from './streamingPI'

describe('streamMessagePI', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockCreateAgentSession.mockClear()
    mockSession.subscribe.mockClear()
    mockSession.prompt.mockClear()
    mockSession.abort.mockClear()
    mockSession.dispose.mockClear()
    mockSession.bindExtensions.mockClear()
    mockDispose.mockClear()

    ;(globalThis as Record<string, unknown>).__lastResourceLoaderOpts = null

    // Default: subscribe captures the listener, prompt resolves immediately
    mockSession.subscribe.mockReturnValue(vi.fn()) // returns unsubscribe fn
    mockSession.prompt.mockResolvedValue(undefined)
  })

  it('returns correct shape with sessionId: null', async () => {
    const result = await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      'system prompt',
      { cwd: '/tmp/test' },
      1
    )

    expect(result).toHaveProperty('content')
    expect(result).toHaveProperty('toolCalls')
    expect(result).toHaveProperty('aborted')
    expect(result.sessionId).toBeNull()
    expect(result.aborted).toBe(false)
    expect(Array.isArray(result.toolCalls)).toBe(true)
  })

  it('sends initial empty text chunk and done chunk', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      42
    )

    // First chunk: empty text
    const textChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'text'
    )
    expect(textChunks.length).toBeGreaterThanOrEqual(1)
    expect((textChunks[0][1] as { content: string }).content).toBe('')

    // Done chunk
    const doneChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'done'
    )
    expect(doneChunks).toHaveLength(1)
    expect((doneChunks[0][1] as { stopReason: string }).stopReason).toBe('end_turn')
  })

  it('maps message_update text_delta events to text chunks', async () => {
    let capturedListener: ((event: unknown) => void) | undefined
    mockSession.subscribe.mockImplementation((listener: (event: unknown) => void) => {
      capturedListener = listener
      return vi.fn()
    })

    mockSession.prompt.mockImplementation(async () => {
      // Simulate text streaming events
      capturedListener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' },
      })
      capturedListener!({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'world' },
      })
    })

    const result = await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    expect(result.content).toBe('Hello world')

    // Check text chunks were sent
    const textChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) =>
        c[0] === 'messages:stream' &&
        (c[1] as { type: string }).type === 'text' &&
        (c[1] as { content: string }).content !== ''
    )
    expect(textChunks).toHaveLength(2)
    expect((textChunks[0][1] as { content: string }).content).toBe('Hello ')
    expect((textChunks[1][1] as { content: string }).content).toBe('world')
  })

  it('maps tool_execution_start to tool_start and tool_input chunks', async () => {
    let capturedListener: ((event: unknown) => void) | undefined
    mockSession.subscribe.mockImplementation((listener: (event: unknown) => void) => {
      capturedListener = listener
      return vi.fn()
    })

    mockSession.prompt.mockImplementation(async () => {
      capturedListener!({
        type: 'tool_execution_start',
        toolCallId: 'tool-1',
        toolName: 'Bash',
        args: { command: 'echo hello' },
      })
    })

    await streamMessagePI(
      [{ role: 'user', content: 'Run echo' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    const toolStartChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'tool_start'
    )
    expect(toolStartChunks).toHaveLength(1)
    expect((toolStartChunks[0][1] as { toolName: string }).toolName).toBe('Bash')
    expect((toolStartChunks[0][1] as { toolId: string }).toolId).toBe('tool-1')

    const toolInputChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'tool_input'
    )
    expect(toolInputChunks).toHaveLength(1)
    expect((toolInputChunks[0][1] as { toolId: string }).toolId).toBe('tool-1')
    expect((toolInputChunks[0][1] as { toolInput: string }).toolInput).toBe('{"command":"echo hello"}')
  })

  it('maps tool_execution_end to tool_result chunk', async () => {
    let capturedListener: ((event: unknown) => void) | undefined
    mockSession.subscribe.mockImplementation((listener: (event: unknown) => void) => {
      capturedListener = listener
      return vi.fn()
    })

    mockSession.prompt.mockImplementation(async () => {
      capturedListener!({
        type: 'tool_execution_start',
        toolCallId: 'tool-2',
        toolName: 'Read',
        args: { path: '/tmp/file.txt' },
      })
      capturedListener!({
        type: 'tool_execution_end',
        toolCallId: 'tool-2',
        toolName: 'Read',
        result: 'file contents here',
        isError: false,
      })
    })

    const result = await streamMessagePI(
      [{ role: 'user', content: 'Read file' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].id).toBe('tool-2')
    expect(result.toolCalls[0].name).toBe('Read')
    expect(result.toolCalls[0].output).toBe('file contents here')
    expect(result.toolCalls[0].status).toBe('done')

    const toolResultChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'tool_result'
    )
    expect(toolResultChunks).toHaveLength(1)
    expect((toolResultChunks[0][1] as { toolOutput: string }).toolOutput).toBe('file contents here')
  })

  it('marks tool as error when isError is true', async () => {
    let capturedListener: ((event: unknown) => void) | undefined
    mockSession.subscribe.mockImplementation((listener: (event: unknown) => void) => {
      capturedListener = listener
      return vi.fn()
    })

    mockSession.prompt.mockImplementation(async () => {
      capturedListener!({
        type: 'tool_execution_start',
        toolCallId: 'tool-err',
        toolName: 'Bash',
        args: { command: 'bad-cmd' },
      })
      capturedListener!({
        type: 'tool_execution_end',
        toolCallId: 'tool-err',
        toolName: 'Bash',
        result: 'command not found',
        isError: true,
      })
    })

    const result = await streamMessagePI(
      [{ role: 'user', content: 'Run bad' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    expect(result.toolCalls[0].status).toBe('error')
  })

  it('sends error chunk when createAgentSession fails', async () => {
    mockCreateAgentSession.mockRejectedValueOnce(new Error('PI auth not configured'))

    const result = await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    const errorChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'error'
    )
    expect(errorChunks).toHaveLength(1)
    expect((errorChunks[0][1] as { content: string }).content).toBe('PI auth not configured')
    expect(result.content).toBe('')
  })

  it('handles abort correctly', async () => {
    mockSession.prompt.mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    )

    const result = await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    expect(result.aborted).toBe(true)
    expect(result.sessionId).toBeNull()

    const doneChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'done'
    )
    expect(doneChunks).toHaveLength(1)
    expect((doneChunks[0][1] as { stopReason: string }).stopReason).toBe('aborted')
  })

  it('passes thinkingLevel based on maxThinkingTokens', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test', maxThinkingTokens: 25000 },
      1
    )

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'medium' })
    )
  })

  it('maps thinkingLevel off when maxThinkingTokens is 0', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test', maxThinkingTokens: 0 },
      1
    )

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'off' })
    )
  })

  it('maps thinkingLevel low when maxThinkingTokens <= 10000', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test', maxThinkingTokens: 5000 },
      1
    )

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'low' })
    )
  })

  it('maps thinkingLevel high when maxThinkingTokens > 50000', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test', maxThinkingTokens: 80000 },
      1
    )

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'high' })
    )
  })

  it('injects system prompt as system_context prefix', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      'You are helpful.',
      { cwd: '/tmp/test' },
      1
    )

    const promptArg = mockSession.prompt.mock.calls[0][0] as string
    expect(promptArg).toContain('<system_context>')
    expect(promptArg).toContain('You are helpful.')
    expect(promptArg).toContain('</system_context>')
    expect(promptArg).toContain('Hello')
  })

  it('sends prompt without system_context when systemPrompt is undefined', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    const promptArg = mockSession.prompt.mock.calls[0][0] as string
    expect(promptArg).not.toContain('<system_context>')
    expect(promptArg).toBe('Hello')
  })

  it('disposes session in all cases', async () => {
    mockSession.prompt.mockRejectedValueOnce(new Error('some error'))

    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    expect(mockSession.dispose).toHaveBeenCalled()
  })

  it('ignores lifecycle events (agent_start, turn_start, etc.)', async () => {
    let capturedListener: ((event: unknown) => void) | undefined
    mockSession.subscribe.mockImplementation((listener: (event: unknown) => void) => {
      capturedListener = listener
      return vi.fn()
    })

    mockSession.prompt.mockImplementation(async () => {
      capturedListener!({ type: 'agent_start' })
      capturedListener!({ type: 'turn_start' })
      capturedListener!({ type: 'message_start', message: {} })
      capturedListener!({ type: 'message_end', message: {} })
      capturedListener!({ type: 'turn_end', message: {}, toolResults: [] })
      capturedListener!({ type: 'agent_end', messages: [] })
    })

    const result = await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    // Only empty text and done chunks — no tool or error chunks from lifecycle events
    const nonTextDone = mockSendFn.mock.calls.filter(
      (c: unknown[]) => {
        const type = (c[1] as { type: string }).type
        return c[0] === 'messages:stream' && type !== 'text' && type !== 'done'
      }
    )
    expect(nonTextDone).toHaveLength(0)
    expect(result.content).toBe('')
    expect(result.toolCalls).toHaveLength(0)
  })

  it('includes conversationId in all chunks', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      99
    )

    const allChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream'
    )
    for (const chunk of allChunks) {
      expect((chunk[1] as { conversationId: number }).conversationId).toBe(99)
    }
  })

  it('passes piExtensionsDir as additionalExtensionPaths to DefaultResourceLoader', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test', piExtensionsDir: '/custom/extensions' },
      1
    )

    expect((globalThis as Record<string, unknown>).__lastResourceLoaderOpts).toEqual(
      expect.objectContaining({
        additionalExtensionPaths: ['/custom/extensions'],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      })
    )
  })

  it('passes resourceLoader to createAgentSession', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    expect(mockCreateAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceLoader: expect.objectContaining({
          reload: expect.any(Function),
          getExtensions: expect.any(Function),
        }),
      })
    )
  })

  it('does not include additionalExtensionPaths when piExtensionsDir is unset', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    expect((globalThis as Record<string, unknown>).__lastResourceLoaderOpts).not.toHaveProperty('additionalExtensionPaths')
  })

  it('passes extensionsOverride callback when piDisabledExtensions is non-empty', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test', piDisabledExtensions: ['/disabled/ext.ts'] },
      1
    )

    const opts = (globalThis as Record<string, unknown>).__lastResourceLoaderOpts as Record<string, unknown>
    expect(opts).toHaveProperty('extensionsOverride')
    expect(typeof opts.extensionsOverride).toBe('function')

    // Verify the filter callback works correctly
    const filter = opts.extensionsOverride as (
      exts: Array<{ resolvedPath: string }>
    ) => Array<{ resolvedPath: string }>
    const filtered = filter([
      { resolvedPath: '/enabled/ext.ts' },
      { resolvedPath: '/disabled/ext.ts' },
    ])
    expect(filtered).toEqual([{ resolvedPath: '/enabled/ext.ts' }])
  })

  it('does not include extensionsOverride when piDisabledExtensions is empty', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test', piDisabledExtensions: [] },
      1
    )

    expect((globalThis as Record<string, unknown>).__lastResourceLoaderOpts).not.toHaveProperty('extensionsOverride')
  })
})
