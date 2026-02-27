import { useState } from 'react'
import type { Folder } from '../../../shared/types'
import type { McpServerName, PIExtensionInfo } from '../../../shared/constants'
import { parseOverrides } from '../../utils/resolveAISettings'
import { useOverrideDraft } from '../../hooks/useOverrideDraft'
import { OverrideFormFields } from './OverrideFormFields'
import { SettingsPopoverShell } from './SettingsPopoverShell'

export type { McpServerName } from '../../../shared/constants'

interface FolderSettingsPopoverProps {
  folder: Folder
  globalSettings: Record<string, string>
  mcpServers: McpServerName[]
  piExtensions?: PIExtensionInfo[]
  onSave: (data: { ai_overrides: string | null; default_cwd: string | null }) => void
  onClose: () => void
}

export function FolderSettingsPopover({
  folder,
  globalSettings,
  mcpServers,
  piExtensions,
  onSave,
  onClose,
}: FolderSettingsPopoverProps) {
  const [cwdValue, setCwdValue] = useState(folder.default_cwd || '')

  const {
    draft, mcpDisabledDraft, mcpDisabledInherited, mcpOverridden,
    toggleMcpOverride, toggleMcpServer,
    cwdWhitelistDraft, cwdWhitelistInherited, cwdWhitelistOverridden,
    toggleCwdWhitelistOverride, setCwdWhitelist,
    piExtDisabledDraft, piExtDisabledInherited, piExtOverridden,
    togglePiExtOverride, togglePiExtension,
    toggleOverride, setValue, cleanDraft,
  } = useOverrideDraft(parseOverrides(folder.ai_overrides), globalSettings)

  const handleBrowseCwd = async () => {
    const selected = await window.agent.system.selectFolder()
    if (selected) setCwdValue(selected)
  }

  const handleSave = () => {
    const cleaned = cleanDraft()
    const aiJson = Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null
    const cwd = cwdValue.trim() || null
    onSave({ ai_overrides: aiJson, default_cwd: cwd })
  }

  return (
    <SettingsPopoverShell title={`Folder: ${folder.name}`} onSave={handleSave} onClose={onClose}>
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
            className="px-2 py-1 rounded text-xs flex-shrink-0 mobile:hidden"
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

      {/* AI Overrides — section headers provided by OverrideFormFields */}
      <div
        className="pt-2 border-t"
        style={{ borderColor: 'var(--color-bg)' }}
      >
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
          cwdWhitelistDraft={cwdWhitelistDraft}
          cwdWhitelistInherited={cwdWhitelistInherited}
          isCwdWhitelistOverridden={cwdWhitelistOverridden}
          onToggleCwdWhitelistOverride={toggleCwdWhitelistOverride}
          onCwdWhitelistChange={setCwdWhitelist}
          piExtensions={piExtensions}
          piExtDisabledDraft={piExtDisabledDraft}
          piExtDisabledInherited={piExtDisabledInherited}
          isPiExtOverridden={piExtOverridden}
          onTogglePiExtOverride={togglePiExtOverride}
          onTogglePiExtension={togglePiExtension}
        />
      </div>
    </SettingsPopoverShell>
  )
}
