import { SETTING_DEFS, type McpServerName, type PIExtensionInfo, parseCustomModels, shortenModelName } from '../../../shared/constants'
import { useSettingsStore } from '../../stores/settingsStore'
import type { CwdWhitelistEntry, AIOverrides } from '../../../shared/types'
import { SectionHeader } from './override/primitives'
import { GenericField } from './override/GenericField'
import { AdvancedSection } from './override/AdvancedSection'

interface OverrideFormFieldsProps {
  draft: Record<string, string | undefined>
  inheritedValues: Record<string, string>
  inheritedSources?: Record<string, string>
  mcpServers: McpServerName[]
  mcpDisabledDraft: string[]
  mcpDisabledInherited: string[]
  isMcpOverridden: boolean
  onDraftChange: (key: string, value: string) => void
  onToggleOverride: (key: string) => void
  onToggleMcpOverride: () => void
  onToggleMcpServer: (name: string) => void
  cwdWhitelistDraft?: CwdWhitelistEntry[]
  cwdWhitelistInherited?: CwdWhitelistEntry[]
  isCwdWhitelistOverridden?: boolean
  onToggleCwdWhitelistOverride?: () => void
  onCwdWhitelistChange?: (entries: CwdWhitelistEntry[]) => void
  piExtensions?: PIExtensionInfo[]
  piExtDisabledDraft?: string[]
  piExtDisabledInherited?: string[]
  isPiExtOverridden?: boolean
  onTogglePiExtOverride?: () => void
  onTogglePiExtension?: (path: string) => void
}

const FIELD_GROUPS = [
  { label: 'Model', keys: ['ai_sdkBackend', 'ai_model'] },
  { label: 'Limits', keys: ['ai_maxTurns', 'ai_maxThinkingTokens', 'ai_maxBudgetUsd'] },
  { label: 'Behavior', keys: ['ai_permissionMode', 'ai_requirePlanApproval', 'ai_skills', 'ai_skillsEnabled', 'hooks_sharedAcrossBackends'] },
  { label: 'Prompts & Files', keys: ['ai_defaultSystemPrompt', 'files_excludePatterns'] },
  { label: 'Voice', keys: ['tts_responseMode', 'tts_summaryPrompt'] },
  { label: 'Integrations', keys: ['webhook_completionUrl'] },
]

const DEF_MAP = new Map(SETTING_DEFS.map(d => [d.key, d]))

export function OverrideFormFields(props: OverrideFormFieldsProps) {
  const { draft, inheritedValues, inheritedSources, onDraftChange, onToggleOverride } = props
  const customModels = parseCustomModels(useSettingsStore((s) => s.settings['ai_customModels']))

  const effectiveBackend = draft['ai_sdkBackend'] ?? inheritedValues['ai_sdkBackend'] ?? 'claude-agent-sdk'
  const isClaudeBackend = effectiveBackend !== 'pi'

  const renderField = (key: string) => {
    const def = DEF_MAP.get(key as keyof AIOverrides)
    if (!def) return null
    if (def.claudeOnly && !isClaudeBackend) return null
    if (def.piOnly && isClaudeBackend) return null
    return (
      <GenericField
        key={def.key}
        def={def}
        draftValue={draft[def.key]}
        inherited={inheritedValues[def.key] || ''}
        source={inheritedSources?.[def.key] || 'Global'}
        customModels={customModels}
        shortenModelName={shortenModelName}
        onToggle={() => onToggleOverride(def.key)}
        onChange={(value) => onDraftChange(def.key, value)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {FIELD_GROUPS.map(group => (
        <div key={group.label} className="flex flex-col gap-1.5">
          <SectionHeader label={group.label} />
          <div className="grid grid-cols-3 gap-2">
            {group.keys.map(renderField)}
          </div>
        </div>
      ))}
      <AdvancedSection {...props} isClaudeBackend={isClaudeBackend} />
    </div>
  )
}
