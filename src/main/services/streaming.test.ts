import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendFn = vi.fn()
vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => ({
    isDestroyed: () => false,
    webContents: { send: (...args: unknown[]) => mockSendFn(...args) },
  })),
}))

const mockQueryFn = vi.fn()
vi.mock('./anthropic', () => ({
  loadAgentSDK: vi.fn().mockResolvedValue({
    query: (...args: unknown[]) => mockQueryFn(...args),
  }),
}))

const mockStreamMessagePI = vi.fn()
vi.mock('./streamingPI', () => ({
  streamMessagePI: (...args: unknown[]) => mockStreamMessagePI(...args),
}))

// Mock sessionManager — tests in this file exercise the one-shot path (persistSession: false)
const mockSendTurn = vi.fn()
vi.mock('./sessionManager', () => ({
  sendTurn: (...args: unknown[]) => mockSendTurn(...args),
  respondToSessionApproval: vi.fn(() => false),
  abortSession: vi.fn(),
  hasActiveSession: vi.fn(() => false),
}))

import { buildPromptWithHistory, streamMessage, registerStreamWindow, notifyConversationUpdated } from './streaming'

describe('buildPromptWithHistory', () => {
  it('returns bare content for a single message', () => {
    const result = buildPromptWithHistory([{ role: 'user', content: 'Hello' }])
    expect(result).toBe('Hello')
    expect(result).not.toContain('User:')
    expect(result).not.toContain('<conversation_history>')
  })

  it('wraps prior turns in XML tags for multi-turn conversations', () => {
    const result = buildPromptWithHistory([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow-up' },
    ])

    expect(result).toContain('<conversation_history>')
    expect(result).toContain('</conversation_history>')
    expect(result).toContain('<msg role="user">First question</msg>')
    expect(result).toContain('<msg role="assistant">First answer</msg>')
    expect(result).not.toContain('User:')
    expect(result).not.toContain('Assistant:')
  })

  it('places the current message outside the history block', () => {
    const result = buildPromptWithHistory([
      { role: 'user', content: 'Old message' },
      { role: 'user', content: 'Current message' },
    ])

    const historyEnd = result.indexOf('</conversation_history>')
    const currentPos = result.indexOf('Current message', historyEnd)
    expect(currentPos).toBeGreaterThan(historyEnd)
    expect(result).not.toContain('<msg role="user">Current message</msg>')
  })

  it('returns empty string for empty messages array', () => {
    const result = buildPromptWithHistory([])
    expect(result).toBe('')
  })
})

describe('streamMessage — SDK session resume', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockQueryFn.mockClear()
  })

  it('passes resume option when sdkSessionId is provided', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'follow-up' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      'session-abc-123',
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.resume).toBe('session-abc-123')
  })

  it('sends only last message content as prompt when resuming', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'follow-up question' },
      ],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      'session-xyz',
      false
    )

    const prompt = mockQueryFn.mock.calls[0][0].prompt
    expect(prompt).toBe('follow-up question')
    expect(prompt).not.toContain('<conversation_history>')
  })

  it('does not set resume when sdkSessionId is null', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      null,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.resume).toBeUndefined()
  })

  it('captures session_id from SDK messages', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: { type: 'system', subtype: 'init', session_id: 'captured-session-id' },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    const result = await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(result.sessionId).toBe('captured-session-id')
  })

  it('returns null sessionId when SDK provides no session_id', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    const result = await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(result.sessionId).toBeNull()
  })

  it('passes persistSession: false when specified', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      null,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.persistSession).toBe(false)
  })

  it('does not set persistSession when not specified', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    // No conversationId → routes to one-shot path without persistSession
    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' }
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.persistSession).toBeUndefined()
  })
})

describe('streamMessage — MCP allowedTools', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockQueryFn.mockClear()
  })

  it('sets allowedTools wildcards when mcpServers are provided', async () => {
    // Mock query to return an async iterable that immediately ends
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      {
        mcpServers: {
          spotify: { command: 'uvx', args: ['mcp-spotify'] },
          github: { command: 'npx', args: ['@mcp/github'] },
        },
        permissionMode: 'bypassPermissions',
      },
      1,
      undefined,
      false
    )

    expect(mockQueryFn).toHaveBeenCalledTimes(1)
    const callArgs = mockQueryFn.mock.calls[0][0]
    const opts = callArgs.options

    expect(opts.mcpServers).toBeDefined()
    expect(opts.allowedTools).toEqual(
      expect.arrayContaining(['mcp__spotify__*', 'mcp__github__*'])
    )
  })

  it('does not set allowedTools when no mcpServers', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.allowedTools).toBeUndefined()
  })

  it('does not set allowedTools when mcpServers is empty object', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { mcpServers: {}, permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.allowedTools).toBeUndefined()
  })
})

describe('streamMessage — Skills settingSources', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockQueryFn.mockClear()
  })

  it('does not set settingSources or Skill in allowedTools when skills=off', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { skills: 'off', permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.settingSources).toBeUndefined()
    expect(opts.allowedTools).toBeUndefined()
  })

  it('sets settingSources=[user] and Skill in allowedTools when skills=user', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { skills: 'user', permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.settingSources).toEqual(['user'])
    expect(opts.allowedTools).toEqual(expect.arrayContaining(['Skill']))
  })

  it('sets settingSources=[user,project] and combines with MCP wildcards when skills=project', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      {
        skills: 'project',
        permissionMode: 'bypassPermissions',
        mcpServers: {
          spotify: { command: 'uvx', args: ['mcp-spotify'] },
        },
      },
      1,
      undefined,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.settingSources).toEqual(['user', 'project'])
    expect(opts.allowedTools).toEqual(
      expect.arrayContaining(['mcp__spotify__*', 'Skill'])
    )
  })

  it('sets settingSources=[user,project,local] when skills=local', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { skills: 'local', permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.settingSources).toEqual(['user', 'project', 'local'])
    expect(opts.allowedTools).toEqual(expect.arrayContaining(['Skill']))
  })

  it('sets settingSources without Skill in allowedTools when skillsEnabled=false', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { skills: 'user', skillsEnabled: false, permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.settingSources).toEqual(['user'])
    // Skill should NOT be in allowedTools
    expect(opts.allowedTools).toBeUndefined()
  })

  it('sets settingSources with Skill when skillsEnabled is undefined (default true)', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { skills: 'project', permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.settingSources).toEqual(['user', 'project'])
    expect(opts.allowedTools).toEqual(expect.arrayContaining(['Skill']))
  })
})

describe('streamMessage — canUseTool disabled skills', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockQueryFn.mockClear()
  })

  it('denies disabled skills even in bypass mode', async () => {
    let capturedCanUseTool: ((toolName: string, input: Record<string, unknown>) => Promise<unknown>) | undefined

    mockQueryFn.mockImplementation((args: { options: Record<string, unknown> }) => {
      capturedCanUseTool = args.options.canUseTool as typeof capturedCanUseTool
      return {
        [Symbol.asyncIterator]: () => ({
          next: vi.fn().mockResolvedValue({ done: true }),
        }),
      }
    })

    const streamPromise = streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      {
        skills: 'user',
        skillsEnabled: true,
        disabledSkills: ['weather-wttr'],
        permissionMode: 'bypassPermissions',
      },
      1,
      undefined,
      false
    )

    await streamPromise

    expect(capturedCanUseTool).toBeDefined()
    const result = await capturedCanUseTool!('Skill', { skill: 'weather-wttr' })
    expect(result).toEqual({ behavior: 'deny', message: 'Skill "weather-wttr" is disabled' })
  })

  it('allows non-disabled skills in bypass mode', async () => {
    let capturedCanUseTool: ((toolName: string, input: Record<string, unknown>) => Promise<unknown>) | undefined

    mockQueryFn.mockImplementation((args: { options: Record<string, unknown> }) => {
      capturedCanUseTool = args.options.canUseTool as typeof capturedCanUseTool
      return {
        [Symbol.asyncIterator]: () => ({
          next: vi.fn().mockResolvedValue({ done: true }),
        }),
      }
    })

    const streamPromise = streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      {
        skills: 'user',
        skillsEnabled: true,
        disabledSkills: ['weather-wttr'],
        permissionMode: 'bypassPermissions',
      },
      1,
      undefined,
      false
    )

    await streamPromise

    expect(capturedCanUseTool).toBeDefined()
    const result = await capturedCanUseTool!('Skill', { skill: 'godot-docs' })
    expect(result).toEqual({ behavior: 'allow', updatedInput: { skill: 'godot-docs' } })
  })

  it('allows Skill tool when disabledSkills is empty', async () => {
    let capturedCanUseTool: ((toolName: string, input: Record<string, unknown>) => Promise<unknown>) | undefined

    mockQueryFn.mockImplementation((args: { options: Record<string, unknown> }) => {
      capturedCanUseTool = args.options.canUseTool as typeof capturedCanUseTool
      return {
        [Symbol.asyncIterator]: () => ({
          next: vi.fn().mockResolvedValue({ done: true }),
        }),
      }
    })

    const streamPromise = streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      {
        skills: 'user',
        disabledSkills: [],
        permissionMode: 'bypassPermissions',
      },
      1,
      undefined,
      false
    )

    await streamPromise

    expect(capturedCanUseTool).toBeDefined()
    const result = await capturedCanUseTool!('Skill', { skill: 'anything' })
    expect(result).toEqual({ behavior: 'allow', updatedInput: { skill: 'anything' } })
  })
})

describe('streamMessage — stopReason in done chunk', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockQueryFn.mockClear()
  })

  function getDoneChunk(): Record<string, unknown> | undefined {
    const call = mockSendFn.mock.calls.find(
      (c: unknown[]) => c[0] === 'messages:stream' && (c[1] as { type: string }).type === 'done'
    )
    return call ? (call[1] as Record<string, unknown>) : undefined
  }

  it('includes stopReason and resultSubtype from success result message', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: { type: 'result', subtype: 'success', stop_reason: 'end_turn' },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const done = getDoneChunk()
    expect(done).toBeDefined()
    expect(done!.stopReason).toBe('end_turn')
    expect(done!.resultSubtype).toBe('success')
  })

  it('includes resultSubtype for error_max_turns', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: { type: 'result', subtype: 'error_max_turns' },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const done = getDoneChunk()
    expect(done!.resultSubtype).toBe('error_max_turns')
  })

  it('captures stop_reason refusal from result message', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: { type: 'result', subtype: 'success', stop_reason: 'refusal' },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const done = getDoneChunk()
    expect(done!.stopReason).toBe('refusal')
  })

  it('sets stopReason to aborted on user abort', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockRejectedValue(Object.assign(new Error('abort'), { name: 'AbortError' })),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const done = getDoneChunk()
    expect(done!.stopReason).toBe('aborted')
  })

  it('does not include stopReason when no result message was received', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const done = getDoneChunk()
    expect(done).toBeDefined()
    expect(done!.stopReason).toBeUndefined()
    expect(done!.resultSubtype).toBeUndefined()
  })
})

describe('streamMessage — canUseTool passthrough for Task tool', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockQueryFn.mockClear()
  })

  it('passes Task tool input through unchanged in bypass mode (persistent sessions handle background agents)', async () => {
    let capturedCanUseTool: ((toolName: string, input: Record<string, unknown>) => Promise<unknown>) | undefined

    mockQueryFn.mockImplementation((args: { options: Record<string, unknown> }) => {
      capturedCanUseTool = args.options.canUseTool as typeof capturedCanUseTool
      return {
        [Symbol.asyncIterator]: () => ({
          next: vi.fn().mockResolvedValue({ done: true }),
        }),
      }
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(capturedCanUseTool).toBeDefined()
    const result = await capturedCanUseTool!('Task', {
      prompt: 'do something',
      run_in_background: true,
      subagent_type: 'general-purpose',
    }) as { behavior: string; updatedInput: Record<string, unknown> }

    expect(result.behavior).toBe('allow')
    expect(result.updatedInput.run_in_background).toBe(true)
    expect(result.updatedInput.prompt).toBe('do something')
  })

  it('does not modify Task input when run_in_background is absent', async () => {
    let capturedCanUseTool: ((toolName: string, input: Record<string, unknown>) => Promise<unknown>) | undefined

    mockQueryFn.mockImplementation((args: { options: Record<string, unknown> }) => {
      capturedCanUseTool = args.options.canUseTool as typeof capturedCanUseTool
      return {
        [Symbol.asyncIterator]: () => ({
          next: vi.fn().mockResolvedValue({ done: true }),
        }),
      }
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(capturedCanUseTool).toBeDefined()
    const result = await capturedCanUseTool!('Task', {
      prompt: 'do something',
      subagent_type: 'general-purpose',
    }) as { behavior: string; updatedInput: Record<string, unknown> }

    expect(result.behavior).toBe('allow')
    expect(result.updatedInput.run_in_background).toBeUndefined()
  })

  it('does not affect non-Task tools with run_in_background', async () => {
    let capturedCanUseTool: ((toolName: string, input: Record<string, unknown>) => Promise<unknown>) | undefined

    mockQueryFn.mockImplementation((args: { options: Record<string, unknown> }) => {
      capturedCanUseTool = args.options.canUseTool as typeof capturedCanUseTool
      return {
        [Symbol.asyncIterator]: () => ({
          next: vi.fn().mockResolvedValue({ done: true }),
        }),
      }
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(capturedCanUseTool).toBeDefined()
    const result = await capturedCanUseTool!('Bash', {
      command: 'echo hello',
      run_in_background: true,
    }) as { behavior: string; updatedInput: Record<string, unknown> }

    expect(result.behavior).toBe('allow')
    expect(result.updatedInput.run_in_background).toBe(true)
  })
})

describe('streamMessage — system init (MCP status)', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockQueryFn.mockClear()
  })

  it('sends mcp_status chunk when system init message with mcp_servers is received', async () => {
    const mcpServers = [
      { name: 'spotify', status: 'connected' },
      { name: 'github', status: 'error', error: 'binary not found' },
    ]

    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: { type: 'system', subtype: 'init', mcp_servers: mcpServers },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system prompt',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    // Find the mcp_status chunk among sent chunks
    const mcpChunks = mockSendFn.mock.calls.filter(
      (call: unknown[]) => call[0] === 'messages:stream' && (call[1] as { type: string }).type === 'mcp_status'
    )
    expect(mcpChunks).toHaveLength(1)
    const payload = mcpChunks[0][1] as { mcpServers: string }
    const parsed = JSON.parse(payload.mcpServers)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].name).toBe('spotify')
    expect(parsed[1].status).toBe('error')
  })

  it('ignores system messages without mcp_servers field', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: { type: 'system', subtype: 'init' },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system prompt',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const mcpChunks = mockSendFn.mock.calls.filter(
      (call: unknown[]) => call[0] === 'messages:stream' && (call[1] as { type: string }).type === 'mcp_status'
    )
    expect(mcpChunks).toHaveLength(0)
  })
})

describe('streamMessage — system hook_response', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockQueryFn.mockClear()
  })

  function getSystemMessageChunks() {
    return mockSendFn.mock.calls.filter(
      (call: unknown[]) => call[0] === 'messages:stream' && (call[1] as { type: string }).type === 'system_message'
    )
  }

  it('sends system_message chunk when hook_response output contains systemMessage JSON', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: {
                type: 'system',
                subtype: 'hook_response',
                hook_name: 'pre-commit',
                hook_event: 'PreToolUse',
                output: JSON.stringify({ systemMessage: 'Lint passed' }),
              },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system prompt',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const chunks = getSystemMessageChunks()
    expect(chunks).toHaveLength(1)
    const payload = chunks[0][1] as { type: string; content: string; hookName: string; hookEvent: string }
    expect(payload.content).toBe('Lint passed')
    expect(payload.hookName).toBe('pre-commit')
    expect(payload.hookEvent).toBe('PreToolUse')
  })

  it('extracts systemMessage from stdout when output is absent', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: {
                type: 'system',
                subtype: 'hook_response',
                hook_name: 'validator',
                stdout: JSON.stringify({ systemMessage: 'From stdout' }),
              },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system prompt',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const chunks = getSystemMessageChunks()
    expect(chunks).toHaveLength(1)
    expect((chunks[0][1] as { content: string }).content).toBe('From stdout')
  })

  it('ignores hook_response when output is not valid JSON', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: {
                type: 'system',
                subtype: 'hook_response',
                output: 'plain text, not JSON',
              },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system prompt',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(getSystemMessageChunks()).toHaveLength(0)
  })

  it('ignores hook_response when JSON lacks systemMessage field', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: {
                type: 'system',
                subtype: 'hook_response',
                output: JSON.stringify({ otherField: 'value' }),
              },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system prompt',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(getSystemMessageChunks()).toHaveLength(0)
  })

  it('omits hookName and hookEvent from payload when not present on system message', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: {
                type: 'system',
                subtype: 'hook_response',
                output: JSON.stringify({ systemMessage: 'No hook info' }),
              },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system prompt',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    const chunks = getSystemMessageChunks()
    expect(chunks).toHaveLength(1)
    const payload = chunks[0][1] as Record<string, unknown>
    expect(payload.content).toBe('No hook info')
    expect(payload).not.toHaveProperty('hookName')
    expect(payload).not.toHaveProperty('hookEvent')
  })

  it('ignores hook_response when output and stdout are both empty', async () => {
    let callCount = 0
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              done: false,
              value: {
                type: 'system',
                subtype: 'hook_response',
              },
            })
          }
          return Promise.resolve({ done: true })
        }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system prompt',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(getSystemMessageChunks()).toHaveLength(0)
  })
})

describe('notifyConversationUpdated', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
  })

  it('broadcasts messages:conversationUpdated to registered stream windows', () => {
    const sendFn = vi.fn()
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: sendFn },
      on: vi.fn(),
    } as unknown as Parameters<typeof registerStreamWindow>[0]

    registerStreamWindow(fakeWin)
    notifyConversationUpdated(42)

    expect(sendFn).toHaveBeenCalledWith('messages:conversationUpdated', 42)
  })

  it('skips destroyed windows', () => {
    const sendFn = vi.fn()
    const fakeWin = {
      isDestroyed: () => true,
      webContents: { send: sendFn },
      on: vi.fn(),
    } as unknown as Parameters<typeof registerStreamWindow>[0]

    registerStreamWindow(fakeWin)
    notifyConversationUpdated(1)

    expect(sendFn).not.toHaveBeenCalled()
  })
})

describe('streamMessage — PI backend delegation', () => {
  beforeEach(() => {
    mockSendFn.mockClear()
    mockQueryFn.mockClear()
    mockStreamMessagePI.mockClear()
  })

  it('delegates to streamMessagePI when sdkBackend is pi', async () => {
    const piResult = { content: 'PI response', toolCalls: [], aborted: false, sessionId: null }
    mockStreamMessagePI.mockResolvedValue(piResult)

    const result = await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { sdkBackend: 'pi', cwd: '/tmp/test' },
      1,
      undefined,
      false
    )

    expect(mockStreamMessagePI).toHaveBeenCalledTimes(1)
    expect(mockStreamMessagePI).toHaveBeenCalledWith(
      [{ role: 'user', content: 'test' }],
      'system',
      { sdkBackend: 'pi', cwd: '/tmp/test' },
      1
    )
    expect(result).toBe(piResult)
    // Claude SDK query should NOT have been called
    expect(mockQueryFn).not.toHaveBeenCalled()
  })

  it('does not delegate when sdkBackend is claude-agent-sdk', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { sdkBackend: 'claude-agent-sdk', permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(mockStreamMessagePI).not.toHaveBeenCalled()
    expect(mockQueryFn).toHaveBeenCalled()
  })

  it('does not delegate when sdkBackend is undefined', async () => {
    mockQueryFn.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: true }),
      }),
    })

    await streamMessage(
      [{ role: 'user', content: 'test' }],
      'system',
      { permissionMode: 'bypassPermissions' },
      1,
      undefined,
      false
    )

    expect(mockStreamMessagePI).not.toHaveBeenCalled()
    expect(mockQueryFn).toHaveBeenCalled()
  })
})
