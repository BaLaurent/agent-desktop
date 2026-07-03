import { useState } from 'react'
import type { StreamPart } from '../../../shared/types'
import { MarkdownRenderer } from './MarkdownRenderer'

type ToolApprovalPart = Extract<StreamPart, { type: 'tool_approval' }>

interface ToolApprovalBlockProps {
  approval: ToolApprovalPart
}

function truncate(value: unknown, maxLen = 200): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str
}

export function ToolApprovalBlock({ approval }: ToolApprovalBlockProps) {
  const [responded, setResponded] = useState<'allow' | 'deny' | null>(null)
  const [denyReason, setDenyReason] = useState('')
  const [dontAskAgain, setDontAskAgain] = useState(false)

  const isExitPlanMode = approval.toolName === 'ExitPlanMode'

  const handleResponse = (behavior: 'allow' | 'deny') => {
    setResponded(behavior)
    if (behavior === 'deny' && isExitPlanMode) {
      const message = denyReason.trim() || 'User rejected the plan — please revise it.'
      window.agent.messages.respondToApproval(approval.requestId, { behavior, message })
      return
    }
    if (behavior === 'allow' && !isExitPlanMode && dontAskAgain) {
      window.agent.messages.respondToApproval(approval.requestId, { behavior, dontAskAgain: true })
      return
    }
    window.agent.messages.respondToApproval(approval.requestId, { behavior })
  }
  const planMarkdown =
    isExitPlanMode && typeof approval.toolInput.plan === 'string'
      ? (approval.toolInput.plan as string)
      : null
  const inputEntries = Object.entries(approval.toolInput)

  return (
    <div
      className="my-2 rounded-md px-3 py-2 text-xs font-mono status-block-warning"
      role="alert"
      aria-label={`Tool approval required for ${approval.toolName}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-warning">
          {'\u{1F6E1}\uFE0F'} {isExitPlanMode ? 'Plan ready — review before leaving plan mode' : `Tool: ${approval.toolName}`}
        </span>
      </div>

      {planMarkdown !== null ? (
        <div className="mt-2 rounded bg-base/40 px-3 py-2 text-sm font-sans max-h-96 overflow-y-auto">
          <MarkdownRenderer content={planMarkdown} />
        </div>
      ) : (
        inputEntries.length > 0 && (
          <div className="mt-1 space-y-0.5 text-muted">
            {inputEntries.map(([key, value]) => (
              <div key={key} className="truncate" title={String(value)}>
                <span className="font-semibold">{key}:</span> {truncate(value)}
              </div>
            ))}
          </div>
        )
      )}

      {responded ? (
        <div
          className={`mt-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${
            responded === 'allow' ? 'chip-success' : 'chip-error'
          }`}
        >
          {responded === 'allow' ? '\u2713 Approved' : '\u2717 Denied'}
        </div>
      ) : (
        <>
          {isExitPlanMode && (
            <div className="mt-3">
              <label
                htmlFor={`deny-reason-${approval.requestId}`}
                className="block text-[0.6875rem] mb-1 font-sans"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Feedback (optional — sent to the agent if you reject the plan):
              </label>
              <textarea
                id={`deny-reason-${approval.requestId}`}
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                rows={2}
                placeholder="e.g. Skip step 2, focus on tests first…"
                className="w-full rounded-lg px-3 py-2 text-sm font-sans outline-none resize-y leading-6"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  border: '1px solid color-mix(in srgb, var(--color-text-muted) 25%, transparent)',
                }}
              />
            </div>
          )}
          {!isExitPlanMode && (
            <label className="mt-2 flex items-center gap-2 text-[0.6875rem] font-sans cursor-pointer" style={{ color: 'var(--color-text-muted)' }}>
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                aria-label={`Don't ask again for the ${approval.toolName} tool`}
              />
              Don't ask again for this tool
            </label>
          )}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => handleResponse('allow')}
              className="rounded font-medium transition-colors hover:opacity-90 bg-success text-contrast px-3 py-1 text-xs mobile:px-5 mobile:py-3 mobile:text-sm"
              aria-label={isExitPlanMode ? 'Approve plan and proceed' : `Allow ${approval.toolName} tool`}
            >
              {isExitPlanMode ? 'Approve & proceed' : 'Allow'}
            </button>
            <button
              onClick={() => handleResponse('deny')}
              className="rounded font-medium transition-colors hover:opacity-90 bg-error text-contrast px-3 py-1 text-xs mobile:px-5 mobile:py-3 mobile:text-sm"
              aria-label={isExitPlanMode ? 'Reject plan and request revisions' : `Deny ${approval.toolName} tool`}
            >
              {isExitPlanMode ? 'Reject & revise' : 'Deny'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
