import type { AIOverrides } from '../../../shared/types'
import type { McpServerName } from '../../../shared/constants'
import { useOverrideDraft } from '../../hooks/useOverrideDraft'
import { OverrideFormFields } from './OverrideFormFields'
import { SettingsPopoverShell } from './SettingsPopoverShell'

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
  const {
    draft, mcpDisabledDraft, mcpDisabledInherited, mcpOverridden,
    toggleMcpOverride, toggleMcpServer,
    cwdWhitelistDraft, cwdWhitelistInherited, cwdWhitelistOverridden,
    toggleCwdWhitelistOverride, setCwdWhitelist,
    toggleOverride, setValue, cleanDraft,
  } = useOverrideDraft(overrides, inheritedValues)

  return (
    <SettingsPopoverShell title={title} onSave={() => onSave(cleanDraft())} onClose={onClose}>
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
        cwdWhitelistDraft={cwdWhitelistDraft}
        cwdWhitelistInherited={cwdWhitelistInherited}
        isCwdWhitelistOverridden={cwdWhitelistOverridden}
        onToggleCwdWhitelistOverride={toggleCwdWhitelistOverride}
        onCwdWhitelistChange={setCwdWhitelist}
      />
    </SettingsPopoverShell>
  )
}
