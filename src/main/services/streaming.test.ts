import { describe, it, expect, vi } from 'vitest'

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

import { buildPromptWithHistory, streamMessage } from './streaming'

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
      1
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
      1
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
      1
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
      1
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
      1
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
      1
    )

    const opts = mockQueryFn.mock.calls[0][0].options
    expect(opts.settingSources).toEqual(['user', 'project'])
    expect(opts.allowedTools).toEqual(
      expect.arrayContaining(['mcp__spotify__*', 'Skill'])
    )
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
      1
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
      1
    )

    const mcpChunks = mockSendFn.mock.calls.filter(
      (call: unknown[]) => call[0] === 'messages:stream' && (call[1] as { type: string }).type === 'mcp_status'
    )
    expect(mcpChunks).toHaveLength(0)
  })
})
