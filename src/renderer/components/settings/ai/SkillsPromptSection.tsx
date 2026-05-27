import type { SlashCommand } from '../../../../shared/types'
import { SettingSourcesRow } from './skills/SettingSourcesRow'
import { ToggleRow } from './skills/ToggleRow'
import { DiscoveredSkillsList } from './skills/DiscoveredSkillsList'
import { SystemPromptEditor } from './skills/SystemPromptEditor'

export type SkillsScope = 'off' | 'user' | 'project' | 'local'

export type SkillsOverhead = Record<SkillsScope, { tokens: number; count: number }> | null

export interface SkillsPromptSectionProps {
  skills: string
  skillsEnabled: string
  skillsIncludePlugins: string
  disabledSkills: string[]
  discoveredSkills: SlashCommand[]
  skillsOverhead: SkillsOverhead
  defaultSystemPrompt: string
  onSkillsChange: (value: string) => void
  onSkillsEnabledChange: (value: string) => void
  onSkillsIncludePluginsChange: (value: string) => void
  onDisabledSkillsChange: (next: string[]) => void
  onDefaultSystemPromptChange: (value: string) => void
}

/**
 * Setting Sources scope, Skills toggle, plugin-skills toggle,
 * per-skill disable list, and the default system prompt editor
 * (with Expand modal).
 */
export function SkillsPromptSection(props: SkillsPromptSectionProps) {
  const {
    skills,
    skillsEnabled,
    skillsIncludePlugins,
    disabledSkills,
    discoveredSkills,
    skillsOverhead,
    defaultSystemPrompt,
    onSkillsChange,
    onSkillsEnabledChange,
    onSkillsIncludePluginsChange,
    onDisabledSkillsChange,
    onDefaultSystemPromptChange,
  } = props

  const skillsOff = skills === 'off'
  const skillsActive = !skillsOff && skillsEnabled === 'true'

  return (
    <>
      <SettingSourcesRow
        skills={skills}
        skillsOverhead={skillsOverhead}
        onSkillsChange={onSkillsChange}
      />

      <ToggleRow
        label="Skills"
        description="Allow the AI to invoke discovered skills."
        checked={skillsEnabled === 'true'}
        disabled={skillsOff}
        ariaLabel="Toggle skills"
        onChange={() => onSkillsEnabledChange(skillsEnabled === 'true' ? 'false' : 'true')}
      />

      <ToggleRow
        label="Include Installed Plugin Skills"
        description="Expose skills from installed Claude plugins (read from ~/.claude/plugins/installed_plugins.json). Excludes marketplace catalogs and cached versions. On PI backend this activates the plugin-skills bridge; on Claude the SDK loads installed-plugin skills natively regardless."
        checked={skillsIncludePlugins === 'true'}
        disabled={!skillsActive}
        ariaLabel="Include installed plugin skills"
        onChange={() => onSkillsIncludePluginsChange(skillsIncludePlugins === 'true' ? 'false' : 'true')}
      />

      {skillsActive && discoveredSkills.length > 0 && (
        <DiscoveredSkillsList
          discoveredSkills={discoveredSkills}
          disabledSkills={disabledSkills}
          onDisabledSkillsChange={onDisabledSkillsChange}
        />
      )}

      <SystemPromptEditor
        value={defaultSystemPrompt}
        onChange={onDefaultSystemPromptChange}
      />
    </>
  )
}
