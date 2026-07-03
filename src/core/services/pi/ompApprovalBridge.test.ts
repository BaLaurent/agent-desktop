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

const { emitPIUIEvent, emitPIUIRequest, uiResponders } = vi.hoisted(() => {
  const uiResponders = new Map<string, (r: unknown) => void>()
  return {
    uiResponders,
    emitPIUIEvent: vi.fn(),
    emitPIUIRequest: vi.fn((request: { id: string }, responder: (r: unknown) => void) => {
      uiResponders.set(request.id, responder)
    }),
  }
})

vi.mock('./piUIChannel', () => ({ emitPIUIEvent, emitPIUIRequest }))

import { attachOmpApprovalBridge, clearOmpDontAskCache } from './ompApprovalBridge'
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
  emitPIUIEvent.mockClear()
  emitPIUIRequest.mockClear()
  uiResponders.clear()
  clearOmpDontAskCache()
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

  it('forwards notify to a piUIChannel toast event (never answers omp)', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({ type: 'extension_ui_request', id: 'u4', method: 'notify', message: 'hi', level: 'warning' })
    await Promise.resolve()

    expect(emitPIUIEvent).toHaveBeenCalledWith({ method: 'notify', message: 'hi', level: 'warning' })
    expect(respondExtensionUI).not.toHaveBeenCalled()
  })

  it('forwards setWidget/setStatus/setTitle to piUIChannel events (never answers omp)', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({ type: 'extension_ui_request', id: 'w1', method: 'setWidget', key: 'logs', content: ['a', 'b'], placement: 'aboveEditor' })
    emit({ type: 'extension_ui_request', id: 's1', method: 'setStatus', key: 'k', text: 'busy' })
    emit({ type: 'extension_ui_request', id: 't1', method: 'setTitle', title: 'Title' })
    await Promise.resolve()

    expect(emitPIUIEvent).toHaveBeenCalledWith({ method: 'setWidget', key: 'logs', content: ['a', 'b'], placement: 'aboveEditor' })
    expect(emitPIUIEvent).toHaveBeenCalledWith({ method: 'setStatus', key: 'k', text: 'busy' })
    expect(emitPIUIEvent).toHaveBeenCalledWith({ method: 'setTitle', title: 'Title' })
    expect(respondExtensionUI).not.toHaveBeenCalled()
  })

  it.each(['set_editor_text', 'cancel'])(
    'does not answer or forward a "%s" request',
    async (method) => {
      const { client, emit, respondExtensionUI } = makeClient()
      attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

      emit({ type: 'extension_ui_request', id: 'u4', method } as OmpExtensionUIRequest)
      await Promise.resolve()

      expect(respondExtensionUI).not.toHaveBeenCalled()
      expect(emitPIUIEvent).not.toHaveBeenCalled()
    },
  )

  it('routes an editor request to a piUIChannel dialog and answers omp with the submitted value', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({ type: 'extension_ui_request', id: 'ed1', method: 'editor', title: 'Edit config', prefill: 'key: val' })
    await Promise.resolve()

    expect(emitPIUIRequest).toHaveBeenCalledWith(
      { id: 'ed1', method: 'editor', title: 'Edit config', prefill: 'key: val' },
      expect.any(Function),
    )
    // Simulate the renderer submitting an edited value.
    uiResponders.get('ed1')!({ id: 'ed1', value: 'key: newval' })
    expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'ed1', value: 'key: newval' })
  })

  it('cancels the omp editor request when the renderer dismisses the dialog', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {} })

    emit({ type: 'extension_ui_request', id: 'ed2', method: 'editor', title: 'Edit' })
    await Promise.resolve()
    uiResponders.get('ed2')!({ id: 'ed2', cancelled: true })
    expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'ed2', cancelled: true })
  })

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

  // ── host-side approval policy (plan mode, cwd boundary, dontAsk cache) ──
  // These decisions run BEFORE surfacing: the critical assertion is which frames
  // auto-resolve (respondExtensionUI Approve/Deny) WITHOUT a tool_approval chunk
  // vs which still surface a tool_approval chunk to the user.

  it('a: plan-mode write auto-denies with a system_message and no tool_approval chunk', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {}, permissionMode: 'plan' })

    emit({ type: 'extension_ui_request', id: 'p1', method: 'select', title: 'Allow tool: write\nPath: x', options: ['Approve', 'Deny'] })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'p1', value: 'Deny' })
    })
    expect(sendChunk).toHaveBeenCalledWith('system_message', expect.any(String), expect.objectContaining({ hookName: 'plan' }))
    expect(sendChunk).not.toHaveBeenCalledWith('tool_approval', expect.anything(), expect.anything())
  })

  it('b: exit_plan_mode auto-approves with no tool_approval chunk', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {}, permissionMode: 'plan' })

    emit({ type: 'extension_ui_request', id: 'p2', method: 'select', title: 'Allow tool: exit_plan_mode', options: ['Approve', 'Deny'] })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'p2', value: 'Approve' })
    })
    expect(sendChunk).not.toHaveBeenCalledWith('tool_approval', expect.anything(), expect.anything())
  })

  it('c: a cwd-out-of-bounds write auto-denies with a system_message and no tool_approval chunk', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {}, cwd: '/tmp/proj', cwdRestrictionEnabled: true })

    emit({ type: 'extension_ui_request', id: 'c1', method: 'select', title: 'Allow tool: write\nPath: /etc/x', options: ['Approve', 'Deny'] })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'c1', value: 'Deny' })
    })
    expect(sendChunk).toHaveBeenCalledWith('system_message', expect.any(String), expect.objectContaining({ hookName: 'cwd' }))
    expect(sendChunk).not.toHaveBeenCalledWith('tool_approval', expect.anything(), expect.anything())
  })

  it('d: an in-bounds write in bypassPermissions auto-approves with no tool_approval chunk', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({
      client, convKey: 1, convExtra: {},
      cwd: '/tmp/proj', cwdRestrictionEnabled: true, permissionMode: 'bypassPermissions',
    })

    emit({ type: 'extension_ui_request', id: 'd1', method: 'select', title: 'Allow tool: write\nPath: sub/f.txt', options: ['Approve', 'Deny'] })

    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'd1', value: 'Approve' })
    })
    expect(sendChunk).not.toHaveBeenCalledWith('tool_approval', expect.anything(), expect.anything())
  })

  it('e: a write whose title has no Path line surfaces tool_approval (fail-safe, not silent)', async () => {
    const { client, emit } = makeClient()
    attachOmpApprovalBridge({
      client, convKey: 1, convExtra: {},
      cwd: '/tmp/proj', cwdRestrictionEnabled: true, permissionMode: 'default',
    })

    emit({ type: 'extension_ui_request', id: 'e1', method: 'select', title: 'Allow tool: write', options: ['Approve', 'Deny'] })

    expect(sendChunk).toHaveBeenCalledWith('tool_approval', undefined, expect.objectContaining({ toolName: 'write' }))
    expect(sendChunk).not.toHaveBeenCalledWith('system_message', expect.anything(), expect.anything())
  })

  it('f: dontAsk caches an allowed tool — a first write surfaces, a second same-tool write auto-approves', async () => {
    const { client, emit, respondExtensionUI } = makeClient()
    attachOmpApprovalBridge({ client, convKey: 1, convExtra: {}, permissionMode: 'default' })

    // First write surfaces to the user; approve with "don't ask again".
    emit({ type: 'extension_ui_request', id: 'f1', method: 'select', title: 'Allow tool: write\nPath: a', options: ['Approve', 'Deny'] })
    const requestId = sendChunk.mock.calls.find((c) => c[0] === 'tool_approval')![2].requestId as string
    respondToApproval(requestId, { behavior: 'allow', dontAskAgain: true })
    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'f1', value: 'Approve' })
    })
    const approvalChunksAfterFirst = sendChunk.mock.calls.filter((c) => c[0] === 'tool_approval').length

    // Second write for the same tool → auto-approved from cache, NO new tool_approval chunk.
    emit({ type: 'extension_ui_request', id: 'f2', method: 'select', title: 'Allow tool: write\nPath: b', options: ['Approve', 'Deny'] })
    await vi.waitFor(() => {
      expect(respondExtensionUI).toHaveBeenCalledWith({ type: 'extension_ui_response', id: 'f2', value: 'Approve' })
    })
    expect(sendChunk.mock.calls.filter((c) => c[0] === 'tool_approval').length).toBe(approvalChunksAfterFirst)
  })
})
