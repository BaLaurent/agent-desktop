import { describe, it, expect, vi } from 'vitest'
import { createCanUseTool, type PendingRequestEntry } from './canUseTool'

function setup(overrides: Partial<Parameters<typeof createCanUseTool>[0]> = {}) {
  const sendChunk = vi.fn()
  const pendingRequests = new Map<string, PendingRequestEntry>()
  const onApprovalStart = vi.fn()
  const onApprovalEnd = vi.fn()

  const canUseTool = createCanUseTool({
    permissionMode: 'default',
    pendingRequestsKey: 42,
    chunkConversationId: 42,
    pendingRequests,
    sendChunk,
    onApprovalStart,
    onApprovalEnd,
    ...overrides,
  })

  return { canUseTool, sendChunk, pendingRequests, onApprovalStart, onApprovalEnd }
}

function latestRequestId(sendChunk: ReturnType<typeof vi.fn>, type: string): string {
  const call = sendChunk.mock.calls.find((c) => c[0] === type)
  return call![2].requestId as string
}

describe('createCanUseTool', () => {
  it('AskUserQuestion opens an ask_user chunk and resolves with selected answers', async () => {
    const { canUseTool, sendChunk, pendingRequests, onApprovalStart, onApprovalEnd } = setup()

    const resultPromise = canUseTool('AskUserQuestion', {
      questions: [{ question: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }],
    })

    await vi.waitFor(() => expect(sendChunk).toHaveBeenCalled())
    expect(onApprovalStart).toHaveBeenCalledTimes(1)
    const requestId = latestRequestId(sendChunk, 'ask_user')
    pendingRequests.get(requestId)!.resolve({ answers: { '0': 'B' } })

    const result = await resultPromise
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions: [{ question: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }],
        // Index key "0" is normalized to the question text the SDK matches on.
        answers: { Pick: 'B' },
      },
    })
    expect(onApprovalEnd).toHaveBeenCalledTimes(1)
  })

  it('normalizes header- and text-keyed answers to question text', async () => {
    const { canUseTool, sendChunk, pendingRequests } = setup()
    const questions = [
      { question: 'Which deliverable?', header: 'Livrable', options: [{ label: 'MD' }] },
      { question: 'Which extras?', header: 'Extras', options: [{ label: 'X' }, { label: 'Y' }] },
    ]
    const resultPromise = canUseTool('AskUserQuestion', { questions })
    await vi.waitFor(() => expect(sendChunk).toHaveBeenCalled())
    const requestId = latestRequestId(sendChunk, 'ask_user')
    // First answer keyed by header, second by full question text (multi-select join).
    pendingRequests.get(requestId)!.resolve({ answers: { Livrable: 'MD', 'Which extras?': 'X,Y' } })

    const result = await resultPromise
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: {
        questions,
        answers: { 'Which deliverable?': 'MD', 'Which extras?': 'X,Y' },
      },
    })
  })

  it('treats a cancelled ask (deny resolution) as a denial, not an empty answer', async () => {
    const { canUseTool, sendChunk, pendingRequests } = setup()
    const resultPromise = canUseTool('AskUserQuestion', {
      questions: [{ question: 'Pick', header: 'P', options: [{ label: 'A' }] }],
    })
    await vi.waitFor(() => expect(sendChunk).toHaveBeenCalled())
    const requestId = latestRequestId(sendChunk, 'ask_user')
    // denyPendingForConversation / session close resolve with a deny (no answers).
    pendingRequests.get(requestId)!.resolve({ behavior: 'deny', message: 'Request cancelled' })

    const result = await resultPromise
    expect(result).toEqual({ behavior: 'deny', message: 'Request cancelled' })
  })

  it('denies disabled skills without asking the user', async () => {
    const { canUseTool, sendChunk } = setup({
      aiSettings: { disabledSkills: ['forbidden'] },
    })
    const result = await canUseTool('Skill', { skill: 'forbidden' })
    expect(result).toEqual({ behavior: 'deny', message: 'Skill "forbidden" is disabled' })
    expect(sendChunk).not.toHaveBeenCalled()
  })

  it('bypass mode auto-approves arbitrary tools immediately', async () => {
    const { canUseTool, sendChunk } = setup({ permissionMode: 'bypassPermissions' })
    const result = await canUseTool('Bash', { command: 'ls' })
    expect(result).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
    expect(sendChunk).not.toHaveBeenCalled()
  })

  it('bypass + requirePlanApproval=true routes ExitPlanMode through the approval popup', async () => {
    const { canUseTool, sendChunk, pendingRequests } = setup({
      permissionMode: 'bypassPermissions',
      aiSettings: { requirePlanApproval: true },
    })

    const resultPromise = canUseTool('ExitPlanMode', { plan: 'Do the thing' })
    await vi.waitFor(() => expect(sendChunk).toHaveBeenCalledWith('tool_approval', undefined, expect.any(Object)))

    const requestId = latestRequestId(sendChunk, 'tool_approval')
    pendingRequests.get(requestId)!.resolve({ behavior: 'allow' })

    const result = await resultPromise
    expect(result).toEqual({ behavior: 'allow', updatedInput: { plan: 'Do the thing' } })
  })

  it('bypass + requirePlanApproval=false still auto-approves ExitPlanMode', async () => {
    const { canUseTool, sendChunk } = setup({
      permissionMode: 'bypassPermissions',
      aiSettings: { requirePlanApproval: false },
    })
    const result = await canUseTool('ExitPlanMode', { plan: 'skip the popup' })
    expect(result).toEqual({ behavior: 'allow', updatedInput: { plan: 'skip the popup' } })
    expect(sendChunk).not.toHaveBeenCalled()
  })

  it('non-bypass mode sends tool_approval chunk and relays deny message', async () => {
    const { canUseTool, sendChunk, pendingRequests } = setup({ permissionMode: 'default' })

    const resultPromise = canUseTool('Bash', { command: 'rm -rf /' })
    await vi.waitFor(() => expect(sendChunk).toHaveBeenCalled())
    const requestId = latestRequestId(sendChunk, 'tool_approval')
    pendingRequests.get(requestId)!.resolve({ behavior: 'deny', message: 'Nope' })

    const result = await resultPromise
    expect(result).toEqual({ behavior: 'deny', message: 'Nope' })
  })

  it('deny without message falls back to default string', async () => {
    const { canUseTool, sendChunk, pendingRequests } = setup({ permissionMode: 'default' })
    const resultPromise = canUseTool('Read', { path: '/etc/passwd' })
    await vi.waitFor(() => expect(sendChunk).toHaveBeenCalled())
    const requestId = latestRequestId(sendChunk, 'tool_approval')
    pendingRequests.get(requestId)!.resolve({ behavior: 'deny' })

    const result = await resultPromise
    expect(result).toEqual({ behavior: 'deny', message: 'User denied this action' })
  })

  it('omits conversationId from chunk when chunkConversationId is null', async () => {
    const { canUseTool, sendChunk, pendingRequests } = setup({
      permissionMode: 'default',
      chunkConversationId: null,
      pendingRequestsKey: -1,
    })
    const resultPromise = canUseTool('Bash', { command: 'echo' })
    await vi.waitFor(() => expect(sendChunk).toHaveBeenCalled())
    const extra = sendChunk.mock.calls[0][2] as Record<string, unknown>
    expect(extra.conversationId).toBeUndefined()

    const requestId = latestRequestId(sendChunk, 'tool_approval')
    pendingRequests.get(requestId)!.resolve({ behavior: 'allow' })
    await resultPromise
  })
})
