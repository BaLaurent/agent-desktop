/**
 * Coverage for `attachOmpApprovalBridge`: routing omp `extension_ui_request`
 * frames to the app's existing `tool_approval` / `ask_user` renderer channel
 * and answering omp with the mapped `extension_ui_response`. The transport
 * (OmpRpcClient) is mocked at the `onExtensionUI`/`respondExtensionUI`
 * boundary — no real subprocess is involved.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

const { sendChunk, pendingRequests, respondToApproval } = vi.hoisted(() => {
  const pendingRequests = new Map<string, { resolve: (value: unknown) => void; conversationId: string | number | null }>()
  return {
    sendChunk: vi.fn(),
    pendingRequests,
    respondToApproval: (requestId: string, response: unknown) => {
      const entry = pendingRequests.get(requestId)
      if (!entry) return
      entry.resolve(response)
      pendingRequests.delete(requestId)
    },
  }
})

vi.mock('../streaming', () => ({ sendChunk, pendingRequests }))

import { attachOmpApprovalBridge } from './ompApprovalBridge'
import type { OmpRpcClient, OmpExtensionUIRequest, OmpExtensionUIResponse } from './ompRpcClient'

type UIListener = (req: OmpExtensionUIRequest) => void

function makeClient(): { client: OmpRpcClient; emit: UIListener; respondExtensionUI: Mock } {
  let captured: UIListener = () => {}
  const respondExtensionUI = vi.fn()
  const fake = {
    onExtensionUI(fn: UIListener) {
      captured = fn
      return () => {}
    },
    respondExtensionUI,
  }
  return { client: fake as unknown as OmpRpcClient, emit: (req) => captured(req), respondExtensionUI }
}

beforeEach(() => {
  sendChunk.mockReset()
  pendingRequests.clear()
})

describe('attachOmpApprovalBridge', () => {
  it('routes an approval select to tool_approval and answers Approve on allow', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({
      type: 'extension_ui_request',
      id: 'u1',
      method: 'select',
      title: 'Allow tool: write\nPath: a',
      options: ['Approve', 'Deny'],
    })

    expect(sendChunk).toHaveBeenCalledWith(
      'tool_approval',
      undefined,
      expect.objectContaining({ toolName: 'write', requestId: expect.any(String) }),
    )
    const requestId = sendChunk.mock.calls[0][2].requestId as string
    expect(pendingRequests.has(requestId)).toBe(true)

    respondToApproval(requestId, { behavior: 'allow' })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'u1', value: 'Approve' })
    })
  })

  it('answers Deny on a deny response', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({
      type: 'extension_ui_request',
      id: 'u2',
      method: 'select',
      title: 'Allow tool: bash\nCommand: rm -rf /',
      options: ['Approve', 'Deny'],
    })

    const requestId = sendChunk.mock.calls[0][2].requestId as string
    respondToApproval(requestId, { behavior: 'deny', message: 'no' })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'u2', value: 'Deny' })
    })
  })

  it('regression: a SYNCHRONOUS responder (resolving from inside the sendChunk call) still completes the round-trip', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    // The bridge MUST register the pendingRequests resolver before calling
    // sendChunk. If it emitted first, a synchronous responder racing to
    // resolve immediately would find no pending entry and the await would
    // hang forever. Wire sendChunk itself to answer synchronously to prove
    // the ordering is safe.
    sendChunk.mockImplementation((type: string, _content: unknown, extra: Record<string, unknown>) => {
      if (type === 'tool_approval') {
        respondToApproval(extra.requestId as string, { behavior: 'allow' })
      }
    })

    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })
    emit({
      type: 'extension_ui_request',
      id: 'u3',
      method: 'select',
      title: 'Allow tool: write\nPath: a',
      options: ['Approve', 'Deny'],
    })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'u3', value: 'Approve' })
    })
    // No leaked pending entry once resolved.
    expect(pendingRequests.size).toBe(0)
  })

  it.each(['notify', 'setWidget', 'setStatus', 'setTitle', 'set_editor_text', 'cancel'])(
    'does not answer a cosmetic "%s" request',
    async (method) => {
      const { client, emit, respondExtensionUI } = makeClient()
      attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

      emit({ type: 'extension_ui_request', id: 'u4', method, message: 'hi' } as OmpExtensionUIRequest)
      // flush microtasks — handleRequest is async but has no await on these paths
      await Promise.resolve()

      expect(respondExtensionUI).not.toHaveBeenCalled()
    },
  )

  it('a genuine question (select without Approve/Deny options) routes to ask_user and answers with the chosen value', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({
      type: 'extension_ui_request',
      id: 'u5',
      method: 'select',
      title: 'Pick a branch',
      options: ['main', 'dev'],
    })

    expect(sendChunk).toHaveBeenCalledWith('ask_user', undefined, expect.objectContaining({ requestId: expect.any(String) }))
    expect(sendChunk).not.toHaveBeenCalledWith('tool_approval', expect.anything(), expect.anything())
    const requestId = sendChunk.mock.calls[0][2].requestId as string

    respondToApproval(requestId, { answers: { '0': 'dev' } })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'u5', value: 'dev' })
    })
  })

  it('a "confirm" question maps a yes-like answer to { confirmed: true }', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({ type: 'extension_ui_request', id: 'u6', method: 'confirm', title: 'Proceed?' })
    const requestId = sendChunk.mock.calls[0][2].requestId as string

    respondToApproval(requestId, { answers: { '0': 'yes' } })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'u6', confirmed: true })
    })
  })

  it('a question with no answers (cancelled ask) cancels the omp request', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({ type: 'extension_ui_request', id: 'u7', method: 'input', title: 'Enter a value' })
    const requestId = sendChunk.mock.calls[0][2].requestId as string

    respondToApproval(requestId, { behavior: 'deny', message: 'Request cancelled' })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'u7', cancelled: true })
    })
  })

  it('an unrecognized method (e.g. open_url) is acknowledged as cancelled so omp never hangs', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({ type: 'extension_ui_request', id: 'u8', method: 'open_url', url: 'https://example.com' })
    await Promise.resolve()

    const response: OmpExtensionUIResponse = { type: 'extension_ui_response', id: 'u8', cancelled: true }
    expect(respondExtensionUI).toHaveBeenCalledWith(response)
  })
})
