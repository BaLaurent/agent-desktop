import { randomUUID } from 'node:crypto'
import type { AskUserQuestion, ToolApprovalResponse } from '../types/types'

export type CanUseToolResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<CanUseToolResult>

export interface PendingRequestEntry {
  resolve: (value: unknown) => void
  conversationId: string | number | null
}

export interface CanUseToolSettings {
  requirePlanApproval?: boolean
  disabledSkills?: string[]
}

export interface CanUseToolDeps {
  aiSettings?: CanUseToolSettings
  permissionMode: string
  /** Included in the chunk payload (omit when no conversation is attached). */
  chunkConversationId?: string | number | null
  /** Stored in pendingRequests for cancellation scoping (always present). */
  pendingRequestsKey: string | number
  pendingRequests: Map<string, PendingRequestEntry>
  sendChunk: (
    type: 'ask_user' | 'tool_approval',
    content: string | undefined,
    extra: Record<string, string | number>,
  ) => void
  onApprovalStart: () => void
  onApprovalEnd: () => void
}

export function createCanUseTool(deps: CanUseToolDeps): CanUseToolFn {
  const {
    aiSettings,
    permissionMode,
    chunkConversationId,
    pendingRequestsKey,
    pendingRequests,
    sendChunk,
    onApprovalStart,
    onApprovalEnd,
  } = deps

  const convExtra: Record<string, string | number> =
    chunkConversationId != null ? { conversationId: chunkConversationId } : {}

  return async (toolName, input) => {
    if (toolName === 'AskUserQuestion') {
      const requestId = randomUUID()
      onApprovalStart()
      try {
        const questions = (input.questions ?? []) as AskUserQuestion[]
        sendChunk('ask_user', undefined, {
          requestId,
          questions: JSON.stringify(questions),
          ...convExtra,
        })

        const response = await new Promise<unknown>((resolve) => {
          pendingRequests.set(requestId, { resolve, conversationId: pendingRequestsKey })
        })

        const askResponse = response as { answers?: Record<string, string>; message?: string }
        // A real answer carries `answers`. A cancellation (abort / WS disconnect /
        // session close) resolves the pending with a deny that has no `answers` —
        // surface it as a denial so the SDK records "user declined" instead of
        // silently proceeding with an empty answer set (which the model reads as
        // "no answer → use the defaults").
        if (!askResponse.answers) {
          return { behavior: 'deny', message: askResponse.message || 'User did not answer the question' }
        }
        // The Claude Agent SDK matches answers to questions by the full question
        // TEXT. UI clients key submitted answers by question index ("0", "1", …),
        // header, or text; normalize every variant to question-text keys here — the
        // one place all backends and clients funnel through — so the user's choices
        // register regardless of which client sent them.
        const rawAnswers = askResponse.answers
        const answers: Record<string, string> = {}
        questions.forEach((q, i) => {
          const value = rawAnswers[String(i)] ?? rawAnswers[q.question] ?? rawAnswers[q.header]
          if (value != null && value !== '') answers[q.question] = value
        })
        return {
          behavior: 'allow',
          updatedInput: { ...input, answers },
        }
      } finally {
        onApprovalEnd()
      }
    }

    if (toolName === 'Skill' && aiSettings?.disabledSkills?.length) {
      const skillName = (input.skill || input.name || '') as string
      if (skillName && aiSettings.disabledSkills.includes(skillName)) {
        return { behavior: 'deny', message: `Skill "${skillName}" is disabled` }
      }
    }

    // Bypass auto-approves everything except ExitPlanMode when the user opted into plan approval.
    const planApprovalRequired =
      toolName === 'ExitPlanMode' && aiSettings?.requirePlanApproval !== false
    if (permissionMode === 'bypassPermissions' && !planApprovalRequired) {
      return { behavior: 'allow', updatedInput: input }
    }

    const requestId = randomUUID()
    onApprovalStart()
    try {
      sendChunk('tool_approval', undefined, {
        requestId,
        toolName,
        toolInput: JSON.stringify(input),
        ...convExtra,
      })

      const response = await new Promise<unknown>((resolve) => {
        pendingRequests.set(requestId, { resolve, conversationId: pendingRequestsKey })
      })

      const approvalResponse = response as ToolApprovalResponse
      if (approvalResponse.behavior === 'allow') {
        return { behavior: 'allow', updatedInput: input }
      }
      return { behavior: 'deny', message: approvalResponse.message || 'User denied this action' }
    } finally {
      onApprovalEnd()
    }
  }
}
