// `exit_plan_mode` host-tool for the omp RPC backend (plan-mode parity).
//
// omp has no native `exit_plan_mode`. To revive the app's existing
// PlanApprovalBlock UI, we supply `exit_plan_mode` as a host-tool while a turn
// runs in plan mode. When the model calls it, we emit a `plan_approval_request`
// chunk (the SAME chunk the renderer already handles via chatStore) carrying
// the plan markdown, and return a short message telling the model to await the
// user's decision. The approval bridge auto-approves the tool call itself so
// omp never surfaces its own prompt for it (see ompApprovalBridge step 1).

import { sendChunk } from '../streaming'
import type { OmpHostTool } from './ompRpcClient'

/** Build the `exit_plan_mode` host-tool bound to the current conversation. */
export function createExitPlanModeTool(convExtra: Record<string, string | number>): OmpHostTool {
  return {
    name: 'exit_plan_mode',
    label: 'Exit Plan Mode',
    description:
      'Present the completed plan to the user for approval before leaving plan mode. Call this once your plan is ready; the user will approve or reject it.',
    parameters: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'The plan to present, in markdown.' },
      },
      required: ['plan'],
      additionalProperties: false,
    },
    execute(params) {
      const plan = typeof params.plan === 'string' ? params.plan : ''
      sendChunk('plan_approval_request', plan, { ...convExtra })
      return 'Plan presented to the user for approval. Await their decision before proceeding.'
    },
  }
}
