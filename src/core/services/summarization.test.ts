import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock both SDKs BEFORE importing the helper.
const claudeQueryMock = vi.fn()
vi.mock('./anthropic', () => ({
  loadAgentSDK: async () => ({ query: claudeQueryMock }),
}))

const mockRunOmpOneShot = vi.fn()
vi.mock('./pi/ompOneShot', () => ({
  runOmpOneShot: (...args: unknown[]) => mockRunOmpOneShot(...args),
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
    mockRunOmpOneShot.mockReset()
  })

  it('routes Claude model to sdk.query and returns assistant text', async () => {
    async function* mockMessages() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'a summary' }] } }
      yield { type: 'result', subtype: 'success', result: 'a summary' }
    }
    claudeQueryMock.mockReturnValueOnce(mockMessages())

    const result = await summarizeWithModel('summarize this', 'claude-haiku-4-5-20251001', { cwd: '/tmp' })
    expect(result).toBe('a summary')
    expect(mockRunOmpOneShot).not.toHaveBeenCalled()
    expect(claudeQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        maxTurns: 1,
        persistSession: false,
      }),
    }))
  })
})

describe('summarizeWithModel — backend override', () => {
  beforeEach(() => {
    claudeQueryMock.mockReset()
    mockRunOmpOneShot.mockReset()
  })

  it("backend:'claude' forces the Claude path for a non-claude model id", async () => {
    async function* mockMessages() {
      yield { type: 'result', subtype: 'success', result: 'yes' }
    }
    claudeQueryMock.mockReturnValueOnce(mockMessages())

    const result = await summarizeWithModel('classify', 'qwen2.5', { cwd: '/tmp', backend: 'claude' })
    expect(result).toBe('yes')
    expect(mockRunOmpOneShot).not.toHaveBeenCalled()
    expect(claudeQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ model: 'qwen2.5' }),
    }))
  })

  it("backend:'pi' forces the PI path for a claude-* model id", async () => {
    mockRunOmpOneShot.mockResolvedValueOnce('chat summary')

    const result = await summarizeWithModel('classify', 'claude-haiku-4-5', { cwd: '/tmp', backend: 'pi' })
    expect(result).toBe('chat summary')
    expect(claudeQueryMock).not.toHaveBeenCalled()
    expect(mockRunOmpOneShot).toHaveBeenCalledWith('classify', { cwd: '/tmp', model: 'claude-haiku-4-5' })
  })
})

describe('summarizeWithModel — PI path', () => {
  beforeEach(() => {
    claudeQueryMock.mockReset()
    mockRunOmpOneShot.mockReset()
  })

  it('routes non-Claude model to runOmpOneShot and returns its resolved text', async () => {
    mockRunOmpOneShot.mockResolvedValueOnce('chat summary')

    const result = await summarizeWithModel('summarize', 'gpt-4o-mini', { cwd: '/tmp' })
    expect(result).toBe('chat summary')
    expect(claudeQueryMock).not.toHaveBeenCalled()
    expect(mockRunOmpOneShot).toHaveBeenCalledWith('summarize', { cwd: '/tmp', model: 'gpt-4o-mini' })
  })

  it('propagates a rejection from runOmpOneShot', async () => {
    mockRunOmpOneShot.mockRejectedValueOnce(new Error('network'))

    await expect(summarizeWithModel('x', 'gpt-4o-mini', { cwd: '/tmp' })).rejects.toThrow('network')
  })
})
