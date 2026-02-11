import { useState, useRef, useMemo, useCallback } from 'react'
import type { AIOverrides } from '../../../shared/types'
import type { McpServerName } from '../../../shared/constants'
import { useClickOutside } from '../../hooks/useClickOutside'
import { parseMcpDisabledList } from '../../utils/mcpUtils'
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
  const [draft, setDraft] = useState<AIOverrides>({ ...overrides })
  const popoverRef = useRef<HTMLDivElement>(null)

  useClickOutside(popoverRef, onClose)

  const mcpDisabledDraft = useMemo(() => parseMcpDisabledList(draft.ai_mcpDisabled), [draft.ai_mcpDisabled])
  const mcpDisabledInherited = useMemo(() => parseMcpDisabledList(inheritedValues['ai_mcpDisabled']), [inheritedValues])

  const mcpOverridden = draft.ai_mcpDisabled !== undefined

  const toggleMcpOverride = useCallback(() => {
    setDraft((prev) => {
      const next = { ...prev }
      if (next.ai_mcpDisabled !== undefined) {
        delete next.ai_mcpDisabled
      } else {
        next.ai_mcpDisabled = inheritedValues['ai_mcpDisabled'] || '[]'
      }
      return next
    })
  }, [inheritedValues])

  const toggleMcpServer = useCallback((serverName: string) => {
    setDraft((prev) => {
      const disabled = new Set(parseMcpDisabledList(prev.ai_mcpDisabled))
      if (disabled.has(serverName)) {
        disabled.delete(serverName)
      } else {
        disabled.add(serverName)
      }
      return { ...prev, ai_mcpDisabled: disabled.size > 0 ? JSON.stringify([...disabled]) : '[]' }
    })
  }, [])

  const toggleOverride = useCallback((key: string) => {
    setDraft((prev) => {
      const next = { ...prev }
      if (next[key as keyof AIOverrides] !== undefined) {
        delete next[key as keyof AIOverrides]
      } else {
        next[key as keyof AIOverrides] = inheritedValues[key] || ''
      }
      return next
    })
  }, [inheritedValues])

  const setValue = useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = () => {
    const cleaned: AIOverrides = {}
    for (const [k, v] of Object.entries(draft)) {
      if (v !== undefined && v !== '') {
        if (k === 'ai_mcpDisabled') {
          cleaned[k] = v
        } else {
          cleaned[k as keyof AIOverrides] = v
        }
      }
    }
    onSave(Object.keys(cleaned).length > 0 ? cleaned : {})
  }

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg shadow-xl text-sm w-[340px]"
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
        className="flex items-center justify-between px-4 py-3 border-b"
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

      {/* Settings */}
      <div className="px-4 py-2 flex flex-col gap-2">
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
        className="flex items-center justify-end gap-2 px-4 py-3 border-t"
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
          onClick={handleSave}
          className="px-3 py-1 rounded text-xs bg-primary text-contrast"
        >
          Save
        </button>
      </div>
    </div>
  )
}
