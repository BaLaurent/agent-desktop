import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSendFn, mockDispose, __testSchedulerBridge } = vi.hoisted(() => ({
  mockSendFn: vi.fn(),
  mockDispose: vi.fn(),
  __testSchedulerBridge: { current: null as unknown },
}))

vi.mock('./piUIContext', () => {
  return {
    PiUIContext: function PiUIContext() {
      this.dispose = mockDispose
      this.handleResponse = vi.fn()
    },
  }
})

vi.mock('./piUIRegistry', () => ({
  registerPiUIContext: vi.fn(),
  unregisterPiUIContext: vi.fn(),
  getActivePiUIContexts: vi.fn(() => [].values()),
}))

// streamingPI now reads scheduler bridge + UI window provider via injected
// accessors on the streaming module. Tests mutate `__testSchedulerBridge.current`
// to flip the bridge on/off without re-importing.
vi.mock('./streaming', async () => {
  const actual = await vi.importActual<typeof import('./streaming')>('./streaming')
  return {
    ...actual,
    // Re-emit chunks as (channel, payload) tuples — matches the legacy
    // `webContents.send` capture shape the assertions below rely on.
    sendChunk: (type: string, content?: string, extra?: Record<string, unknown>) => {
      mockSendFn('messages:stream', { type, content, ...extra })
    },
    getPIUIWindowProvider: () => () => ({
      isDestroyed: () => false,
      webContents: { send: (...a: unknown[]) => mockSendFn(...a) },
    }),
    getPISchedulerBridge: () => __testSchedulerBridge.current,
  }
})

// Mock DB helpers from core handlers/messages — tests don't need a real sqlite instance
vi.mock('../handlers/messages', () => ({
  getConversationPiSessionFile: vi.fn().mockReturnValue(null),
  setConversationPiSessionFile: vi.fn(),
}))

// Mock getDatabase — returns a sentinel; actual queries go through messages mock above
vi.mock('../db/database', () => ({
  getDatabase: vi.fn().mockReturnValue({ __sentinel: true }),
}))

// Mock node:fs existsSync — controlled per test
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}))

// Mock MCP client module
vi.mock('./mcpClient', () => ({
  createMcpClient: vi.fn(),
  McpConnectError: class McpConnectError extends Error {
    serverName: string
    constructor(name: string, cause: unknown) {
      const causeMessage = cause instanceof Error ? cause.message : String(cause)
      super(`MCP server '${name}' failed to connect: ${causeMessage}`)
      this.name = 'McpConnectError'
      this.serverName = name
    }
  },
}))

// Mock createCanUseTool so permission gate tests can spy on the returned fn.
// The factory stores the spy in globalThis so tests can access it across the hoist boundary.
vi.mock('./canUseTool', () => ({
  createCanUseTool: vi.fn((_deps: unknown) => {
    const spy = vi.fn().mockResolvedValue({ behavior: 'allow', updatedInput: {} })
    ;(globalThis as Record<string, unknown>).__lastCanUseToolSpy = spy
    return spy
  }),
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
vi.mock('./pi/sdkLoader', () => {
  // Must be defined inside factory — vi.mock is hoisted
  const _mockReload = vi.fn().mockResolvedValue(undefined)
  const _mockGetExtensions = vi.fn().mockReturnValue({ extensions: [] })
  return {
    loadPISdk: vi.fn().mockResolvedValue({
      createAgentSession: (...args: unknown[]) => mockCreateAgentSession(...args),
      SessionManager: {
        inMemory: vi.fn().mockReturnValue({}),
        create: vi.fn().mockReturnValue({ getSessionFile: () => '/tmp/pi-sessions/new.jsonl' }),
        open: vi.fn().mockReturnValue({ getSessionFile: () => '/tmp/pi-sessions/existing.jsonl' }),
      },
      DefaultResourceLoader: function DefaultResourceLoader(opts: Record<string, unknown>) {
        ;(globalThis as Record<string, unknown>).__lastResourceLoaderOpts = opts
        return { reload: _mockReload, getExtensions: _mockGetExtensions }
      },
      codingTools: [],
    }),
  }
})

import { streamMessagePI } from './streamingPI'
import { getConversationPiSessionFile, setConversationPiSessionFile } from '../handlers/messages'
import { getDatabase } from '../db/database'
import * as nodeFs from 'node:fs'
import { loadPISdk } from './pi/sdkLoader'
import { createCanUseTool } from './canUseTool'

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

    // Reset session persistence mocks to safe defaults
    vi.mocked(getConversationPiSessionFile).mockReturnValue(null)
    vi.mocked(setConversationPiSessionFile).mockReset()
    vi.mocked(nodeFs.existsSync).mockReturnValue(false)
    vi.mocked(getDatabase).mockReturnValue({ __sentinel: true } as unknown as ReturnType<typeof getDatabase>)
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

    const opts = (globalThis as Record<string, unknown>).__lastResourceLoaderOpts as Record<string, unknown>
    expect(opts).toEqual(
      expect.objectContaining({
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      })
    )
    const paths = opts.additionalExtensionPaths as string[]
    expect(paths).toEqual(['/custom/extensions'])
    expect(typeof (opts.extensionFactories as unknown[])[0]).toBe('function')
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

  it('omits additionalExtensionPaths when piExtensionsDir is unset (bundled factory is registered inline)', async () => {
    await streamMessagePI(
      [{ role: 'user', content: 'Hi' }],
      undefined,
      { cwd: '/tmp/test' },
      1
    )

    const opts = (globalThis as Record<string, unknown>).__lastResourceLoaderOpts as Record<string, unknown>
    expect(opts.additionalExtensionPaths).toBeUndefined()
    expect(typeof (opts.extensionFactories as unknown[])[0]).toBe('function')
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

    // Verify the filter callback works correctly — receives LoadExtensionsResult, returns filtered result
    const filter = opts.extensionsOverride as (
      result: { extensions: Array<{ resolvedPath: string }>; [k: string]: unknown }
    ) => { extensions: Array<{ resolvedPath: string }>; [k: string]: unknown }
    const input = {
      extensions: [
        { resolvedPath: '/enabled/ext.ts' },
        { resolvedPath: '/disabled/ext.ts' },
      ],
      errors: [],
      runtime: {},
    }
    const filtered = filter(input)
    expect(filtered.extensions).toEqual([{ resolvedPath: '/enabled/ext.ts' }])
    expect(filtered.errors).toEqual([])
    expect(filtered.runtime).toEqual({})
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

describe('session persistence', () => {
  beforeEach(async () => {
    mockSendFn.mockClear()
    mockCreateAgentSession.mockClear()
    mockSession.subscribe.mockClear()
    mockSession.prompt.mockClear()
    mockSession.abort.mockClear()
    mockSession.dispose.mockClear()
    mockSession.bindExtensions.mockClear()
    mockDispose.mockClear()

    mockSession.subscribe.mockReturnValue(vi.fn())
    mockSession.prompt.mockResolvedValue(undefined)

    // Safe defaults for persistence mocks
    vi.mocked(getConversationPiSessionFile).mockReturnValue(null)
    vi.mocked(setConversationPiSessionFile).mockReset()
    vi.mocked(nodeFs.existsSync).mockReturnValue(false)
    vi.mocked(getDatabase).mockReturnValue({ __sentinel: true } as unknown as ReturnType<typeof getDatabase>)

    // Reset and configure SessionManager factory spies
    const pi = await loadPISdk()
    vi.mocked(pi.SessionManager.inMemory).mockClear().mockReturnValue({})
    vi.mocked(pi.SessionManager.create).mockClear().mockReturnValue({ getSessionFile: () => '/tmp/pi-sessions/new.jsonl' } as unknown as ReturnType<typeof pi.SessionManager.create>)
    vi.mocked(pi.SessionManager.open).mockClear().mockReturnValue({ getSessionFile: () => '/tmp/pi-sessions/existing.jsonl' } as unknown as ReturnType<typeof pi.SessionManager.open>)
  })

  it('uses SessionManager.open when pi_session_file exists and file is present', async () => {
    const pi = await loadPISdk()
    vi.mocked(getConversationPiSessionFile).mockReturnValue('/tmp/pi-sessions/existing.jsonl')
    vi.mocked(nodeFs.existsSync).mockReturnValue(true)

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test' },
      42,
    )

    expect(pi.SessionManager.open).toHaveBeenCalledWith('/tmp/pi-sessions/existing.jsonl')
    expect(pi.SessionManager.create).not.toHaveBeenCalled()
    expect(pi.SessionManager.inMemory).not.toHaveBeenCalled()
    // open path does not write back — file already persisted
    expect(setConversationPiSessionFile).not.toHaveBeenCalled()
  })

  it('falls back to SessionManager.create when pi_session_file is null', async () => {
    const pi = await loadPISdk()
    vi.mocked(getConversationPiSessionFile).mockReturnValue(null)

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test' },
      42,
    )

    expect(pi.SessionManager.create).toHaveBeenCalledWith('/tmp/test')
    expect(pi.SessionManager.open).not.toHaveBeenCalled()
    expect(pi.SessionManager.inMemory).not.toHaveBeenCalled()
  })

  it('falls back to create when SessionManager.open throws', async () => {
    const pi = await loadPISdk()
    vi.mocked(getConversationPiSessionFile).mockReturnValue('/tmp/pi-sessions/corrupt.jsonl')
    vi.mocked(nodeFs.existsSync).mockReturnValue(true)
    vi.mocked(pi.SessionManager.open).mockImplementationOnce(() => {
      throw new Error('corrupted session')
    })

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test' },
      42,
    )

    // Clears the stale DB entry
    expect(setConversationPiSessionFile).toHaveBeenCalledWith(
      expect.anything(),
      42,
      null,
    )
    // Falls through to create
    expect(pi.SessionManager.create).toHaveBeenCalledWith('/tmp/test')
  })

  it('persists session file path back to DB after create', async () => {
    const pi = await loadPISdk()
    vi.mocked(getConversationPiSessionFile).mockReturnValue(null)
    vi.mocked(pi.SessionManager.create).mockReturnValue({
      getSessionFile: () => '/tmp/pi-sessions/2025-01-01_abc.jsonl',
    } as unknown as ReturnType<typeof pi.SessionManager.create>)

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test' },
      42,
    )

    expect(setConversationPiSessionFile).toHaveBeenCalledWith(
      expect.anything(),
      42,
      '/tmp/pi-sessions/2025-01-01_abc.jsonl',
    )
  })

  it('uses SessionManager.inMemory when conversationId is undefined (one-shot)', async () => {
    const pi = await loadPISdk()

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test' },
      undefined,
    )

    expect(pi.SessionManager.inMemory).toHaveBeenCalled()
    expect(pi.SessionManager.create).not.toHaveBeenCalled()
    expect(pi.SessionManager.open).not.toHaveBeenCalled()
    // No DB writes for one-shot
    expect(setConversationPiSessionFile).not.toHaveBeenCalled()
  })
})

describe('streamMessagePI — MCP integration', () => {
  beforeEach(async () => {
    mockSendFn.mockClear()
    mockCreateAgentSession.mockClear()
    mockSession.subscribe.mockClear()
    mockSession.prompt.mockClear()
    mockSession.abort.mockClear()
    mockSession.dispose.mockClear()
    mockSession.bindExtensions.mockClear()
    mockDispose.mockClear()

    mockSession.subscribe.mockReturnValue(vi.fn())
    mockSession.prompt.mockResolvedValue(undefined)

    vi.mocked(getConversationPiSessionFile).mockReturnValue(null)
    vi.mocked(setConversationPiSessionFile).mockReset()
    vi.mocked(nodeFs.existsSync).mockReturnValue(false)
    vi.mocked(getDatabase).mockReturnValue({ __sentinel: true } as unknown as ReturnType<typeof getDatabase>)

    // Reset MCP mocks
    const { createMcpClient } = await import('./mcpClient')
    vi.mocked(createMcpClient).mockReset()
  })

  it('spawns a client per configured MCP server and appends their tools to customTools', async () => {
    const { createMcpClient } = await import('./mcpClient')
    const closeSpy = vi.fn().mockResolvedValue(undefined)
    vi.mocked(createMcpClient).mockResolvedValue({
      name: 'fs',
      tools: [{ name: 'read', description: 'read a file', inputSchema: { type: 'object' } }],
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      close: closeSpy,
    })

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test', mcpServers: { fs: { command: 'fs-server', args: [] } } },
      1,
    )

    expect(createMcpClient).toHaveBeenCalledWith('fs', { command: 'fs-server', args: [] })
    const callArg = mockCreateAgentSession.mock.calls[0][0] as { customTools: Array<{ name: string }> }
    expect(callArg.customTools.some((t) => t.name === 'mcp__fs__read')).toBe(true)
  })

  it('closes clients in finally block on success path', async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined)
    const { createMcpClient } = await import('./mcpClient')
    vi.mocked(createMcpClient).mockResolvedValue({
      name: 'fs',
      tools: [],
      callTool: vi.fn(),
      close: closeSpy,
    })

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test', mcpServers: { fs: { command: 'fs-server', args: [] } } },
      1,
    )

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('closes clients in finally block on abort path', async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined)
    const { createMcpClient } = await import('./mcpClient')
    vi.mocked(createMcpClient).mockResolvedValue({
      name: 'fs',
      tools: [],
      callTool: vi.fn(),
      close: closeSpy,
    })

    mockSession.prompt.mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    )

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test', mcpServers: { fs: { command: 'fs-server', args: [] } } },
      1,
    )

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('skips server names containing __ defensively', async () => {
    const { createMcpClient } = await import('./mcpClient')
    const closeSpy = vi.fn().mockResolvedValue(undefined)
    vi.mocked(createMcpClient).mockResolvedValue({
      name: 'good',
      tools: [],
      callTool: vi.fn(),
      close: closeSpy,
    })

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      {
        cwd: '/tmp/test',
        mcpServers: {
          good: { command: 'good-server', args: [] },
          'bad__name': { command: 'bad-server', args: [] },
        },
      },
      1,
    )

    expect(createMcpClient).toHaveBeenCalledWith('good', expect.anything())
    expect(createMcpClient).not.toHaveBeenCalledWith('bad__name', expect.anything())
  })

  it('emits system_message chunk and continues when a server fails to spawn', async () => {
    const { createMcpClient, McpConnectError } = await import('./mcpClient')
    const closeSpy = vi.fn().mockResolvedValue(undefined)
    vi.mocked(createMcpClient).mockImplementation((name: string) => {
      if (name === 'broken') {
        return Promise.reject(new McpConnectError('broken', new Error('spawn failed')))
      }
      return Promise.resolve({
        name,
        tools: [],
        callTool: vi.fn(),
        close: closeSpy,
      })
    })

    const result = await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      {
        cwd: '/tmp/test',
        mcpServers: {
          broken: { command: 'bad', args: [] },
          ok: { command: 'good', args: [] },
        },
      },
      1,
    )

    // System_message chunks: spawn_started + spawn_failed (broken) + spawn_complete
    const sysChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'system_message'
    )
    expect(sysChunks).toHaveLength(3)
    const spawnFailed = sysChunks.find(
      (c) => (c[1] as { hookEvent?: string }).hookEvent === 'spawn_failed'
    )
    expect(spawnFailed).toBeDefined()
    expect((spawnFailed![1] as { content: string }).content).toContain('broken')

    // Stream finished normally (not aborted, no error chunk)
    expect(result.aborted).toBe(false)
    const errorChunks = mockSendFn.mock.calls.filter(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'error'
    )
    expect(errorChunks).toHaveLength(0)

    // The ok server's client was still closed
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})

describe('streamMessagePI — permission gate', () => {
  beforeEach(async () => {
    mockSendFn.mockClear()
    mockCreateAgentSession.mockClear()
    mockSession.subscribe.mockClear()
    mockSession.prompt.mockClear()
    mockSession.abort.mockClear()
    mockSession.dispose.mockClear()
    mockSession.bindExtensions.mockClear()
    mockDispose.mockClear()
    ;(globalThis as Record<string, unknown>).__lastCanUseToolSpy = undefined

    mockSession.subscribe.mockReturnValue(vi.fn())
    mockSession.prompt.mockResolvedValue(undefined)

    vi.mocked(getConversationPiSessionFile).mockReturnValue(null)
    vi.mocked(setConversationPiSessionFile).mockReset()
    vi.mocked(nodeFs.existsSync).mockReturnValue(false)
    vi.mocked(getDatabase).mockReturnValue({ __sentinel: true } as unknown as ReturnType<typeof getDatabase>)

    // Reset createCanUseTool mock to default (allow) for each test
    vi.mocked(createCanUseTool).mockClear().mockImplementation((_deps: unknown) => {
      const spy = vi.fn().mockResolvedValue({ behavior: 'allow', updatedInput: {} })
      ;(globalThis as Record<string, unknown>).__lastCanUseToolSpy = spy
      return spy
    })

    const { createMcpClient } = await import('./mcpClient')
    vi.mocked(createMcpClient).mockReset()
  })

  it('gates MCP tools with canUseTool when permissionMode is not bypassPermissions', async () => {
    const { createMcpClient } = await import('./mcpClient')
    const callToolSpy = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    vi.mocked(createMcpClient).mockResolvedValue({
      name: 'fs',
      tools: [{ name: 'read', description: 'read a file', inputSchema: { type: 'object' } }],
      callTool: callToolSpy,
      close: vi.fn().mockResolvedValue(undefined),
    })

    // canUseTool denies to prove the gate intercepted the call before callTool
    vi.mocked(createCanUseTool).mockImplementation((_deps: unknown) => {
      const spy = vi.fn().mockResolvedValue({ behavior: 'deny', message: 'denied by test' })
      ;(globalThis as Record<string, unknown>).__lastCanUseToolSpy = spy
      return spy
    })

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test', permissionMode: 'default', mcpServers: { fs: { command: 'fs-server', args: [] } } },
      1,
    )

    // createCanUseTool was called (once per stream, not once per tool)
    expect(createCanUseTool).toHaveBeenCalledTimes(1)
    expect(createCanUseTool).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionMode: 'default',
        chunkConversationId: 1,
        pendingRequestsKey: 1,
      })
    )

    // The tool was registered with gating: invoke its execute directly to confirm callTool is blocked
    const callArgs = mockCreateAgentSession.mock.calls[0][0] as { customTools: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> }
    const mcpTool = callArgs.customTools.find((t) => t.name === 'mcp__fs__read')
    expect(mcpTool).toBeDefined()

    // Execute the gated tool — canUseTool denies, so callTool must NOT be called
    await mcpTool!.execute('tid', {}, undefined, undefined, undefined)
    const canUseToolSpy = (globalThis as Record<string, unknown>).__lastCanUseToolSpy as ReturnType<typeof vi.fn>
    expect(canUseToolSpy).toHaveBeenCalledWith('mcp__fs__read', {})
    expect(callToolSpy).not.toHaveBeenCalled()
  })

  it('does not gate MCP tools when permissionMode is bypassPermissions', async () => {
    const { createMcpClient } = await import('./mcpClient')
    const callToolSpy = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    vi.mocked(createMcpClient).mockResolvedValue({
      name: 'fs',
      tools: [{ name: 'read', description: 'read a file', inputSchema: { type: 'object' } }],
      callTool: callToolSpy,
      close: vi.fn().mockResolvedValue(undefined),
    })

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test', permissionMode: 'bypassPermissions', mcpServers: { fs: { command: 'fs-server', args: [] } } },
      1,
    )

    // Execute the (bypass) tool — canUseTool spy must NOT be called; callTool IS called
    const callArgs = mockCreateAgentSession.mock.calls[0][0] as { customTools: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> }
    const mcpTool = callArgs.customTools.find((t) => t.name === 'mcp__fs__read')
    expect(mcpTool).toBeDefined()

    await mcpTool!.execute('tid', {}, undefined, undefined, undefined)
    const canUseToolSpy = (globalThis as Record<string, unknown>).__lastCanUseToolSpy as ReturnType<typeof vi.fn>
    // bypass: gatePiTools returns the original array — canUseTool is never invoked
    expect(canUseToolSpy).not.toHaveBeenCalled()
    expect(callToolSpy).toHaveBeenCalledTimes(1)
  })

  it('does not gate the scheduler tool (canUseTool not called when scheduler.execute runs)', async () => {
    const { createMcpClient } = await import('./mcpClient')
    vi.mocked(createMcpClient).mockResolvedValue({
      name: 'fs',
      tools: [{ name: 'read', description: 'read a file', inputSchema: { type: 'object' } }],
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
      close: vi.fn().mockResolvedValue(undefined),
    })

    // Enable scheduler bridge via the hoisted state captured by ./streaming mock.
    __testSchedulerBridge.current = {
      getMcpConfig: () => ({ name: 'scheduler' }),
      getSocketPath: () => '/tmp/sched.sock',
      getAuthToken: () => 'test-token',
    }

    // canUseTool denies everything — if scheduler were gated, it would be denied before execute
    vi.mocked(createCanUseTool).mockImplementation((_deps: unknown) => {
      const spy = vi.fn().mockResolvedValue({ behavior: 'deny', message: 'denied by test' })
      ;(globalThis as Record<string, unknown>).__lastCanUseToolSpy = spy
      return spy
    })

    await streamMessagePI(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { cwd: '/tmp/test', permissionMode: 'default', mcpServers: { fs: { command: 'fs-server', args: [] } } },
      1,
    )

    const callArgs = mockCreateAgentSession.mock.calls[0][0] as { customTools: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> }
    const scheduler = callArgs.customTools.find((t) => t.name === 'agent_scheduler')
    expect(scheduler).toBeDefined()

    // Invoke the scheduler's execute directly — the gate wraps execute with a canUseTool check
    // BEFORE calling through (deny returns early before the original execute is ever called).
    // If not gated, execute runs and fails on the socket connection (no real bridge running).
    // Either way, canUseTool must NOT have been consulted for scheduler.execute.
    await expect(scheduler!.execute('call-1', { conversation_id: 1, command: 'list' }, undefined, undefined, {} as never))
      .rejects.toThrow()

    const canUseToolSpy = (globalThis as Record<string, unknown>).__lastCanUseToolSpy as ReturnType<typeof vi.fn>
    expect(canUseToolSpy).not.toHaveBeenCalled()
  })
})
