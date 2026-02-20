import { useRef } from 'react'
import type { AIOverrides } from '../../../shared/types'
import type { McpServerName } from '../../../shared/constants'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useOverrideDraft } from '../../hooks/useOverrideDraft'
import { OverrideFormFields } from './OverrideFormFields'

interface AIOverridesPopoverProps {
  overrides: AIOverrides
  inheritedValues: Record<string, string>
  inheritedSources: Record<string, string>
  onSave: (overrides: AIOverrides) => void
  onClose: () => void
  title: string
  mcpServers?: McpServerName[]
}

export function AIOverridesPopover({
  overrides,
  inheritedValues,
  inheritedSources,
  onSave,
  onClose,
  title,
  mcpServers,
}: AIOverridesPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  useClickOutside(popoverRef, onClose)

  const {
    draft, mcpDisabledDraft, mcpDisabledInherited, mcpOverridden,
    toggleMcpOverride, toggleMcpServer, toggleOverride, setValue, cleanDraft,
  } = useOverrideDraft(overrides, inheritedValues)

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg shadow-xl text-sm w-[340px] max-h-[80vh] flex flex-col"
      style={{
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-text-muted)',
        color: 'var(--color-text)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-bg)' }}
      >
        <span className="font-medium">{title}</span>
        <button
          onClick={onClose}
          className="text-xs px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ color: 'var(--color-text-muted)' }}
        >
          x
        </button>
      </div>

      {/* Scrollable body */}
      <div className="px-4 py-2 flex flex-col gap-2 overflow-y-auto flex-1">
        <OverrideFormFields
          draft={draft}
          inheritedValues={inheritedValues}
          inheritedSources={inheritedSources}
          mcpServers={mcpServers || []}
          mcpDisabledDraft={mcpDisabledDraft}
          mcpDisabledInherited={mcpDisabledInherited}
          isMcpOverridden={mcpOverridden}
          onDraftChange={setValue}
          onToggleOverride={toggleOverride}
          onToggleMcpOverride={toggleMcpOverride}
          onToggleMcpServer={toggleMcpServer}
        />
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-end gap-2 px-4 py-3 border-t flex-shrink-0"
        style={{ borderColor: 'var(--color-bg)' }}
      >
        <button
          onClick={onClose}
          className="px-3 py-1 rounded text-xs"
          style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(cleanDraft())}
          className="px-3 py-1 rounded text-xs bg-primary text-contrast"
        >
          Save
        </button>
      </div>
    </div>
  )
}
