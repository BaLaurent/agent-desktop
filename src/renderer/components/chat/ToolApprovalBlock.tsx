import { useState } from 'react'
import type { StreamPart } from '../../../shared/types'

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

  const handleResponse = (behavior: 'allow' | 'deny') => {
    setResponded(behavior)
    window.agent.messages.respondToApproval(approval.requestId, { behavior })
  }

  const inputEntries = Object.entries(approval.toolInput)

  return (
    <div
      className="my-2 rounded-md px-3 py-2 text-xs font-mono status-block-warning"
      role="alert"
      aria-label={`Tool approval required for ${approval.toolName}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-warning">
          {'\u{1F6E1}\uFE0F'} Tool: {approval.toolName}
        </span>
      </div>

      {inputEntries.length > 0 && (
        <div className="mt-1 space-y-0.5 text-muted">
          {inputEntries.map(([key, value]) => (
            <div key={key} className="truncate" title={String(value)}>
              <span className="font-semibold">{key}:</span> {truncate(value)}
            </div>
          ))}
        </div>
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
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => handleResponse('allow')}
            className="px-3 py-1 rounded text-xs font-medium transition-colors hover:opacity-90 bg-success text-contrast"
            aria-label={`Allow ${approval.toolName} tool`}
          >
            Allow
          </button>
          <button
            onClick={() => handleResponse('deny')}
            className="px-3 py-1 rounded text-xs font-medium transition-colors hover:opacity-90 bg-error text-contrast"
            aria-label={`Deny ${approval.toolName} tool`}
          >
            Deny
          </button>
        </div>
      )}
    </div>
  )
}
