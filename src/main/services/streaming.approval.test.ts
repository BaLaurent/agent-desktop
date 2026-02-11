import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => ({
    isDestroyed: () => false,
    webContents: { send: (...args: unknown[]) => mockSend(...args) },
  })),
}))

vi.mock('./anthropic', () => ({
  loadAgentSDK: vi.fn(),
}))

import { respondToApproval, abortStream, streamMessage } from './streaming'
import { loadAgentSDK } from './anthropic'
import type { ToolApprovalResponse } from '../../shared/types'

describe('streaming approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('respondToApproval', () => {
    it('is a no-op for unknown request IDs', () => {
      respondToApproval('nonexistent_id', { behavior: 'allow' } as ToolApprovalResponse)
    })

    it('does not throw for deny responses either', () => {
      respondToApproval('another_unknown', { behavior: 'deny' } as ToolApprovalResponse)
    })
  })

  describe('abortStream', () => {
    it('does not throw when no active stream', () => {
      expect(() => abortStream()).not.toThrow()
    })

    it('can be called multiple times safely', () => {
      abortStream()
      abortStream()
    })
  })

  describe('canUseTool response format', () => {
    let capturedCanUseTool: (toolName: string, input: Record<string, unknown>) => Promise<unknown>

    beforeEach(() => {
      capturedCanUseTool = null as unknown as typeof capturedCanUseTool

      // Mock SDK to capture the canUseTool callback from queryOptions
      vi.mocked(loadAgentSDK).mockResolvedValue({
        query: ({ options }: { prompt: string; options: Record<string, unknown> }) => {
          if (typeof options.canUseTool === 'function') {
            capturedCanUseTool = options.canUseTool as typeof capturedCanUseTool
          }
          // Return an async iterable that yields nothing (stream ends immediately)
          return (async function* () {})()
        },
      } as ReturnType<typeof loadAgentSDK> extends Promise<infer T> ? T : never)
    })

    it('allow response includes updatedInput with original tool input', async () => {
      const toolInput = { url: 'https://example.com', method: 'GET' }
      const streamPromise = streamMessage(
        [{ role: 'user', content: 'test' }],
        undefined,
        { permissionMode: 'default' },
      )

      // Wait for the SDK to be initialized and canUseTool to be captured
      await vi.waitFor(() => expect(capturedCanUseTool).toBeTruthy())

      // Invoke canUseTool and resolve approval in parallel
      const approvalPromise = capturedCanUseTool('WebFetch', toolInput)

      // Find the pending request ID from the sent chunks
      await vi.waitFor(() => {
        const approvalChunk = mockSend.mock.calls.find(
          (call) => call[1]?.type === 'tool_approval'
        )
        expect(approvalChunk).toBeTruthy()
      })

      const approvalChunk = mockSend.mock.calls.find(
        (call) => call[1]?.type === 'tool_approval'
      )
      const requestId = approvalChunk![1].requestId as string

      // Simulate user clicking "Allow"
      respondToApproval(requestId, { behavior: 'allow' })

      const result = await approvalPromise
      expect(result).toEqual({
        behavior: 'allow',
        updatedInput: { url: 'https://example.com', method: 'GET' },
      })

      await streamPromise
    })

    it('deny response includes message string', async () => {
      const toolInput = { command: 'rm -rf /' }
      const streamPromise = streamMessage(
        [{ role: 'user', content: 'test' }],
        undefined,
        { permissionMode: 'default' },
      )

      await vi.waitFor(() => expect(capturedCanUseTool).toBeTruthy())

      const approvalPromise = capturedCanUseTool('Bash', toolInput)

      await vi.waitFor(() => {
        const approvalChunk = mockSend.mock.calls.find(
          (call) => call[1]?.type === 'tool_approval'
        )
        expect(approvalChunk).toBeTruthy()
      })

      const approvalChunk = mockSend.mock.calls.find(
        (call) => call[1]?.type === 'tool_approval'
      )
      const requestId = approvalChunk![1].requestId as string

      // Simulate user clicking "Deny"
      respondToApproval(requestId, { behavior: 'deny', message: 'Too dangerous' })

      const result = await approvalPromise
      expect(result).toEqual({
        behavior: 'deny',
        message: 'Too dangerous',
      })

      await streamPromise
    })

    it('deny response uses default message when user provides none', async () => {
      const toolInput = { path: '/etc/passwd' }
      const streamPromise = streamMessage(
        [{ role: 'user', content: 'test' }],
        undefined,
        { permissionMode: 'default' },
      )

      await vi.waitFor(() => expect(capturedCanUseTool).toBeTruthy())

      const approvalPromise = capturedCanUseTool('Read', toolInput)

      await vi.waitFor(() => {
        const approvalChunk = mockSend.mock.calls.find(
          (call) => call[1]?.type === 'tool_approval'
        )
        expect(approvalChunk).toBeTruthy()
      })

      const approvalChunk = mockSend.mock.calls.find(
        (call) => call[1]?.type === 'tool_approval'
      )
      const requestId = approvalChunk![1].requestId as string

      // Deny without a custom message
      respondToApproval(requestId, { behavior: 'deny' })

      const result = await approvalPromise
      expect(result).toEqual({
        behavior: 'deny',
        message: 'User denied this action',
      })

      await streamPromise
    })

    it('AskUserQuestion returns updatedInput with answers', async () => {
      const toolInput = {
        questions: [{ question: 'Pick a color', options: [{ label: 'Red' }, { label: 'Blue' }] }],
      }
      const streamPromise = streamMessage(
        [{ role: 'user', content: 'test' }],
        undefined,
        { permissionMode: 'default' },
      )

      await vi.waitFor(() => expect(capturedCanUseTool).toBeTruthy())

      const approvalPromise = capturedCanUseTool('AskUserQuestion', toolInput)

      await vi.waitFor(() => {
        const askChunk = mockSend.mock.calls.find(
          (call) => call[1]?.type === 'ask_user'
        )
        expect(askChunk).toBeTruthy()
      })

      const askChunk = mockSend.mock.calls.find(
        (call) => call[1]?.type === 'ask_user'
      )
      const requestId = askChunk![1].requestId as string

      // Simulate user answering
      respondToApproval(requestId, { answers: { '0': 'Blue' } })

      const result = await approvalPromise
      expect(result).toEqual({
        behavior: 'allow',
        updatedInput: {
          questions: toolInput.questions,
          answers: { '0': 'Blue' },
        },
      })

      await streamPromise
    })

    it('bypassPermissions mode sets canUseTool (for AskUserQuestion) alongside allowDangerouslySkipPermissions', async () => {
      let capturedOptions: Record<string, unknown> = {}

      vi.mocked(loadAgentSDK).mockResolvedValue({
        query: ({ options }: { prompt: string; options: Record<string, unknown> }) => {
          capturedOptions = options
          return (async function* () {})()
        },
      } as ReturnType<typeof loadAgentSDK> extends Promise<infer T> ? T : never)

      await streamMessage(
        [{ role: 'user', content: 'test' }],
        undefined,
        { permissionMode: 'bypassPermissions' },
      )

      // canUseTool is always set now — it intercepts AskUserQuestion in all modes
      expect(capturedOptions.canUseTool).toBeTypeOf('function')
      expect(capturedOptions.allowDangerouslySkipPermissions).toBe(true)
    })

    it('bypassPermissions canUseTool auto-approves non-AskUserQuestion tools', async () => {
      let capturedCanUseTool: (toolName: string, input: Record<string, unknown>) => Promise<unknown>

      vi.mocked(loadAgentSDK).mockResolvedValue({
        query: ({ options }: { prompt: string; options: Record<string, unknown> }) => {
          if (typeof options.canUseTool === 'function') {
            capturedCanUseTool = options.canUseTool as typeof capturedCanUseTool
          }
          return (async function* () {})()
        },
      } as ReturnType<typeof loadAgentSDK> extends Promise<infer T> ? T : never)

      await streamMessage(
        [{ role: 'user', content: 'test' }],
        undefined,
        { permissionMode: 'bypassPermissions' },
      )

      // Non-AskUserQuestion tools should be auto-approved immediately in bypass mode
      const result = await capturedCanUseTool!('Bash', { command: 'ls' })
      expect(result).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    })
  })

  describe('denyAllPending includes message', () => {
    let capturedCanUseTool: (toolName: string, input: Record<string, unknown>) => Promise<unknown>

    beforeEach(() => {
      capturedCanUseTool = null as unknown as typeof capturedCanUseTool

      vi.mocked(loadAgentSDK).mockResolvedValue({
        query: ({ options }: { prompt: string; options: Record<string, unknown> }) => {
          if (typeof options.canUseTool === 'function') {
            capturedCanUseTool = options.canUseTool as typeof capturedCanUseTool
          }
          return (async function* () {})()
        },
      } as ReturnType<typeof loadAgentSDK> extends Promise<infer T> ? T : never)
    })

    it('abort resolves pending approvals with deny + message', async () => {
      const streamPromise = streamMessage(
        [{ role: 'user', content: 'test' }],
        undefined,
        { permissionMode: 'default' },
      )

      await vi.waitFor(() => expect(capturedCanUseTool).toBeTruthy())

      // Start an approval that will be pending
      const approvalPromise = capturedCanUseTool('Bash', { command: 'ls' })

      await vi.waitFor(() => {
        const approvalChunk = mockSend.mock.calls.find(
          (call) => call[1]?.type === 'tool_approval'
        )
        expect(approvalChunk).toBeTruthy()
      })

      // Abort the stream — should deny all pending with message
      abortStream()

      const result = await approvalPromise
      expect(result).toEqual({
        behavior: 'deny',
        message: 'Request cancelled',
      })

      await streamPromise
    })
  })
})
