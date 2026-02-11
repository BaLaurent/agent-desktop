import { useState, useRef, useMemo, useCallback } from 'react'
import type { Folder, AIOverrides } from '../../../shared/types'
import type { McpServerName } from '../../../shared/constants'
import { parseOverrides } from '../../utils/resolveAISettings'
import { useClickOutside } from '../../hooks/useClickOutside'
import { parseMcpDisabledList } from '../../utils/mcpUtils'
import { OverrideFormFields } from './OverrideFormFields'

export type { McpServerName } from '../../../shared/constants'

interface FolderSettingsPopoverProps {
  folder: Folder
  globalSettings: Record<string, string>
  mcpServers: McpServerName[]
  onSave: (data: { ai_overrides: string | null; default_cwd: string | null }) => void
  onClose: () => void
}

export function FolderSettingsPopover({
  folder,
  globalSettings,
  mcpServers,
  onSave,
  onClose,
}: FolderSettingsPopoverProps) {
  const [draft, setDraft] = useState<AIOverrides>(() => parseOverrides(folder.ai_overrides))
  const [cwdValue, setCwdValue] = useState(folder.default_cwd || '')
  const popoverRef = useRef<HTMLDivElement>(null)

  useClickOutside(popoverRef, onClose)

  const mcpDisabledDraft = useMemo(() => parseMcpDisabledList(draft.ai_mcpDisabled), [draft.ai_mcpDisabled])
  const mcpDisabledInherited = useMemo(() => parseMcpDisabledList(globalSettings['ai_mcpDisabled']), [globalSettings])

  const mcpOverridden = draft.ai_mcpDisabled !== undefined

  const toggleMcpOverride = useCallback(() => {
    setDraft((prev) => {
      const next = { ...prev }
      if (next.ai_mcpDisabled !== undefined) {
        delete next.ai_mcpDisabled
      } else {
        next.ai_mcpDisabled = globalSettings['ai_mcpDisabled'] || '[]'
      }
      return next
    })
  }, [globalSettings])

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
        next[key as keyof AIOverrides] = globalSettings[key] || ''
      }
      return next
    })
  }, [globalSettings])

  const setValue = useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleBrowseCwd = async () => {
    const selected = await window.agent.system.selectFolder()
    if (selected) setCwdValue(selected)
  }

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
    const aiJson = Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null
    const cwd = cwdValue.trim() || null
    onSave({ ai_overrides: aiJson, default_cwd: cwd })
  }

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg shadow-xl text-sm w-[360px] max-h-[80vh] flex flex-col"
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
        <span className="font-medium">Folder: {folder.name}</span>
        <button
          onClick={onClose}
          className="text-xs px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Close folder settings"
        >
          x
        </button>
      </div>

      {/* Scrollable body */}
      <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto flex-1">
        {/* Default Working Directory */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Default Working Directory
          </label>
          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            New conversations in this folder will use this CWD.
          </p>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={cwdValue}
              onChange={(e) => setCwdValue(e.target.value)}
              placeholder="Inherit from conversation"
              className="flex-1 px-2 py-1 rounded text-xs border outline-none min-w-0"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                borderColor: cwdValue ? 'var(--color-primary)' : 'var(--color-text-muted)',
              }}
              aria-label="Default working directory path"
            />
            <button
              onClick={handleBrowseCwd}
              className="px-2 py-1 rounded text-xs flex-shrink-0"
              style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
              aria-label="Browse for directory"
            >
              Browse
            </button>
            {cwdValue && (
              <button
                onClick={() => setCwdValue('')}
                className="px-1.5 py-1 rounded text-xs flex-shrink-0"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label="Clear default working directory"
              >
                x
              </button>
            )}
          </div>
        </div>

        {/* AI Overrides */}
        <div
          className="flex flex-col gap-2 pt-2 border-t"
          style={{ borderColor: 'var(--color-bg)' }}
        >
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            AI Overrides
          </label>

          <OverrideFormFields
            draft={draft}
            inheritedValues={globalSettings}
            mcpServers={mcpServers}
            mcpDisabledDraft={mcpDisabledDraft}
            mcpDisabledInherited={mcpDisabledInherited}
            isMcpOverridden={mcpOverridden}
            onDraftChange={setValue}
            onToggleOverride={toggleOverride}
            onToggleMcpOverride={toggleMcpOverride}
            onToggleMcpServer={toggleMcpServer}
          />
        </div>
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
          onClick={handleSave}
          className="px-3 py-1 rounded text-xs bg-primary text-contrast"
        >
          Save
        </button>
      </div>
    </div>
  )
}
