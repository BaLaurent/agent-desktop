import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock both SDKs BEFORE importing the helper.
const claudeQueryMock = vi.fn()
vi.mock('./anthropic', () => ({
  loadAgentSDK: async () => ({ query: claudeQueryMock }),
}))

const piSessionPromptMock = vi.fn()
const piSubscribeMock = vi.fn()
const piDisposeMock = vi.fn()
const piCreateSessionMock = vi.fn()
const mockResolvePIModel = vi.fn()
const mockCreatePIModelContext = vi.fn()
vi.mock('./pi/sdkLoader', () => ({
  loadPISdk: async () => ({
    createAgentSession: piCreateSessionMock,
    SessionManager: { inMemory: () => ({}) },
    codingTools: [],
  }),
}))
vi.mock('./pi/modelRegistry', () => ({
  resolvePIModel: (...args: unknown[]) => mockResolvePIModel(...args),
  createPIModelContext: (...args: unknown[]) => mockCreatePIModelContext(...args),
}))

import { summarizeWithModel, isClaudeModel } from './summarization'

describe('isClaudeModel', () => {
  it.each([
    ['claude-haiku-4-5-20251001', true],
    ['claude-sonnet-4-6', true],
    ['claude-opus-4-7', true],
    ['gpt-4o-mini', false],
    ['gemini-2.0-flash', false],
    ['llama-3.3-70b', false],
    ['', false],
  ])('%s → %s', (model, expected) => {
    expect(isClaudeModel(model)).toBe(expected)
  })
})

describe('summarizeWithModel — Claude path', () => {
  beforeEach(() => {
    claudeQueryMock.mockReset()
    piCreateSessionMock.mockReset()
  })

  it('routes Claude model to sdk.query and returns assistant text', async () => {
    async function* mockMessages() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'a summary' }] } }
      yield { type: 'result', subtype: 'success', result: 'a summary' }
    }
    claudeQueryMock.mockReturnValueOnce(mockMessages())

    const result = await summarizeWithModel('summarize this', 'claude-haiku-4-5-20251001', { cwd: '/tmp' })
    expect(result).toBe('a summary')
    expect(piCreateSessionMock).not.toHaveBeenCalled()
    expect(claudeQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        maxTurns: 1,
        persistSession: false,
      }),
    }))
  })
})

describe('summarizeWithModel — PI path', () => {
  beforeEach(() => {
    claudeQueryMock.mockReset()
    piCreateSessionMock.mockReset()
    piSessionPromptMock.mockReset()
    piSubscribeMock.mockReset()
    piDisposeMock.mockReset()
    mockResolvePIModel.mockReset()
    mockResolvePIModel.mockResolvedValue({ provider: 'openai', id: 'gpt-4o-mini' })
    mockCreatePIModelContext.mockReset()
    mockCreatePIModelContext.mockResolvedValue({
      authStorage: { type: 'auth' },
      modelRegistry: { type: 'registry' },
    })
  })

  it('routes non-Claude model to pi.createAgentSession and collects text_delta events', async () => {
    let capturedHandler: ((event: unknown) => void) | null = null
    piSubscribeMock.mockImplementation((handler: (event: unknown) => void) => {
      capturedHandler = handler
      return () => {}
    })
    piSessionPromptMock.mockImplementation(async () => {
      capturedHandler?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'chat ' } })
      capturedHandler?.({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'summary' } })
    })
    piCreateSessionMock.mockResolvedValueOnce({
      session: {
        subscribe: piSubscribeMock,
        prompt: piSessionPromptMock,
        dispose: piDisposeMock,
      },
    })

    const result = await summarizeWithModel('summarize', 'gpt-4o-mini', { cwd: '/tmp' })
    expect(result).toBe('chat summary')
    expect(claudeQueryMock).not.toHaveBeenCalled()
    expect(piDisposeMock).toHaveBeenCalledOnce()
    expect(mockResolvePIModel).toHaveBeenCalledWith('gpt-4o-mini')
    expect(piCreateSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      model: { provider: 'openai', id: 'gpt-4o-mini' },
    }))
  })

  it('disposes the PI session even if prompt throws', async () => {
    piSubscribeMock.mockReturnValue(() => {})
    piSessionPromptMock.mockRejectedValueOnce(new Error('network'))
    piCreateSessionMock.mockResolvedValueOnce({
      session: {
        subscribe: piSubscribeMock,
        prompt: piSessionPromptMock,
        dispose: piDisposeMock,
      },
    })

    await expect(summarizeWithModel('x', 'gpt-4o-mini', { cwd: '/tmp' })).rejects.toThrow('network')
    expect(piDisposeMock).toHaveBeenCalledOnce()
  })
})
