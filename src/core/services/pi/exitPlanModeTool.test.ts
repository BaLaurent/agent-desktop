/**
 * Coverage for the `exit_plan_mode` host-tool: executing it must emit the
 * renderer-facing `plan_approval_request` chunk (bound to the conversation) and
 * return a short "await the user" message so the model stops. `../streaming` is
 * mocked at the sendChunk boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendChunk } = vi.hoisted(() => ({ sendChunk: vi.fn() }))
vi.mock('../streaming', () => ({ sendChunk }))

import { createExitPlanModeTool } from './exitPlanModeTool'
import type { OmpHostToolContext } from './ompRpcClient'

const ctx: OmpHostToolContext = {
  toolCallId: 't',
  signal: new AbortController().signal,
  sendUpdate() {},
}

beforeEach(() => {
  sendChunk.mockReset()
})

describe('createExitPlanModeTool', () => {
  it('emits plan_approval_request with the plan (bound to the conversation) and returns an await message', async () => {
    const tool = createExitPlanModeTool({ conversationId: 42 })
    const result = await tool.execute({ plan: '# Plan' }, ctx)

    expect(sendChunk).toHaveBeenCalledWith('plan_approval_request', '# Plan', { conversationId: 42 })
    expect(typeof result).toBe('string')
    expect(result as string).toMatch(/await|approval/i)
  })

  it('emits an empty plan string when the plan param is missing', async () => {
    const tool = createExitPlanModeTool({ conversationId: 7 })
    const result = await tool.execute({}, ctx)

    expect(sendChunk).toHaveBeenCalledWith('plan_approval_request', '', { conversationId: 7 })
    expect(result as string).toMatch(/await|approval/i)
  })

  it('has the expected tool shape (name exit_plan_mode, plan required)', () => {
    const tool = createExitPlanModeTool({})
    expect(tool.name).toBe('exit_plan_mode')
    const params = tool.parameters as { required?: string[] }
    expect(params.required).toContain('plan')
  })
})
