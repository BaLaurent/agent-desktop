import { useEffect, useMemo, useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAuthStore } from '../../stores/authStore'
import {
  DEFAULT_MODEL,
  parseCustomModels,
  parseCustomModelContextLengths,
  type PIExtensionInfo,
} from '../../../shared/constants'
import { mapModelToBackend, parseLastModelByBackend } from '../../../core/services/modelBackendMap'
import { useModelsStore } from '../../stores/modelsStore'
import type { CwdWhitelistEntry, SlashCommand } from '../../../shared/types'
import { IdentityBackendSection } from './ai/IdentityBackendSection'
import { CredentialsSection } from './ai/CredentialsSection'
import { ModelSection } from './ai/ModelSection'
import { PermissionsSection } from './ai/PermissionsSection'
import { SkillsPromptSection, type SkillsOverhead, type SkillsScope } from './ai/SkillsPromptSection'
import { resolveSetting, parseJsonArraySetting } from './ai/aiSettingsDefaults'

type Setter = (key: string, value: string) => void
function bindSetter(setSetting: Setter, key: string): (value: string) => void {
  return (value) => setSetting(key, value)
}
function bindJsonSetter<T>(setSetting: Setter, key: string): (next: T) => void {
  return (next) => setSetting(key, JSON.stringify(next))
}

export function AISettings() {
  const { settings, loadSettings, setSetting } = useSettingsStore()
  const { checkAuth } = useAuthStore()
  const fetchedModels = useModelsStore((s) => s.models)
  const fetchModels = useModelsStore((s) => s.fetch)

  useEffect(() => { loadSettings() }, [loadSettings])

  const get = useCallback((key: string) => resolveSetting(settings, key), [settings])

  const sdkBackend = get('ai_sdkBackend')
  const isClaudeBackend = sdkBackend !== 'pi'

  useEffect(() => { fetchModels(sdkBackend) }, [fetchModels, sdkBackend])

  const apiKey = get('ai_apiKey')
  const customModel = get('ai_customModel')
  const skills = get('ai_skills')
  const piExtensionsDir = get('pi_extensionsDir')
  const model = settings['ai_model'] || DEFAULT_MODEL
  // What the picker shows: the id adapted to the active backend (the
  // stored value is kept intact; only the displayed/effective selection
  // is mapped, matching the runtime resolver). Internal logic below
  // keeps using the raw `model`.
  const lastModelByBackend = parseLastModelByBackend(settings['ai_lastModelByBackend'])
  const mapForBackend = (id: string) =>
    mapModelToBackend(id, sdkBackend, { lastModelByBackend }) ?? id
  const displayModel = mapForBackend(model)
  const customModels = parseCustomModels(settings['ai_customModels'])
  const customModelContextLengths = parseCustomModelContextLengths(settings['ai_customModelContextLengths'])
  const cwdWhitelist = parseJsonArraySetting<CwdWhitelistEntry>(settings['hooks_cwdWhitelist'])
  const piDisabledExtensions = parseJsonArraySetting<string>(settings['pi_disabledExtensions'])
  const disabledSkills = parseJsonArraySetting<string>(settings['ai_disabledSkills'])

  const [skillsOverhead, setSkillsOverhead] = useState<SkillsOverhead>(null)
  const [discoveredSkills, setDiscoveredSkills] = useState<SlashCommand[]>([])
  const [piExtensions, setPiExtensions] = useState<PIExtensionInfo[]>([])

  useEffect(() => {
    if (!isClaudeBackend) return
    window.agent.context.getSkillsOverhead()
      .then((r) => setSkillsOverhead(r as SkillsOverhead))
      .catch(() => setSkillsOverhead(null))
  }, [isClaudeBackend])

  useEffect(() => {
    if (skills === 'off') {
      setDiscoveredSkills([])
      return
    }
    window.agent.commands.list(undefined, skills as SkillsScope)
      .then((cmds: SlashCommand[]) => setDiscoveredSkills(cmds.filter((c) => c.source === 'skill')))
      .catch(() => setDiscoveredSkills([]))
  }, [skills])

  useEffect(() => {
    if (isClaudeBackend) {
      setPiExtensions([])
      return
    }
    window.agent.pi.listExtensions()
      .then(setPiExtensions)
      .catch(() => setPiExtensions([]))
  }, [isClaudeBackend, piExtensionsDir])

  const handleApiKeyChange = useCallback((value: string) => {
    setSetting('ai_apiKey', value)
    setTimeout(() => checkAuth(), 300)
  }, [setSetting, checkAuth])

  const handleModelChange = useCallback((next: string) => {
    if (next === 'custom') {
      setSetting('ai_model', 'custom')
    } else {
      setSetting('ai_model', next)
      setSetting('ai_customModel', '')
    }
  }, [setSetting])

  const saveCustomModel = useCallback((value: string) => {
    const trimmed = value.trim()
    const presetValues = new Set(fetchedModels.map((o) => o.value))
    if (!trimmed || presetValues.has(trimmed) || customModels.includes(trimmed)) return
    setSetting('ai_customModels', JSON.stringify([...customModels, trimmed]))
  }, [customModels, fetchedModels, setSetting])

  const removeCustomModel = useCallback((value: string) => {
    const next = customModels.filter((m) => m !== value)
    setSetting('ai_customModels', JSON.stringify(next))
    if (model === value) {
      setSetting('ai_model', DEFAULT_MODEL)
      setSetting('ai_customModel', '')
    }
  }, [customModels, model, setSetting])

  const setCustomModelContextLength = useCallback((modelId: string, lengthInK: number | null) => {
    const next = { ...customModelContextLengths }
    if (lengthInK == null || lengthInK <= 0) {
      delete next[modelId]
    } else {
      next[modelId] = Math.round(lengthInK * 1000)
    }
    setSetting('ai_customModelContextLengths', JSON.stringify(next))
  }, [customModelContextLengths, setSetting])

  const browseExtensionsDir = useCallback(async () => {
    const selected = await window.agent.system.selectFolder()
    if (selected) setSetting('pi_extensionsDir', selected)
  }, [setSetting])

  // Pre-bound setters keep the JSX tree free of inline arrows so the
  // orchestrator's cyclomatic complexity stays low.
  const setters = useMemo(() => ({
    agentName: bindSetter(setSetting, 'agent_name'),
    agentLanguage: bindSetter(setSetting, 'agent_language'),
    agentPersonality: bindSetter(setSetting, 'agent_personality'),
    sdkBackend: bindSetter(setSetting, 'ai_sdkBackend'),
    piExtensionsDir: bindSetter(setSetting, 'pi_extensionsDir'),
    piDisabledExtensions: bindJsonSetter<string[]>(setSetting, 'pi_disabledExtensions'),
    baseUrl: bindSetter(setSetting, 'ai_baseUrl'),
    customModel: bindSetter(setSetting, 'ai_customModel'),
    contextTokenCounter: bindSetter(setSetting, 'ai_contextTokenCounter'),
    maxTurns: bindSetter(setSetting, 'ai_maxTurns'),
    maxThinkingTokens: bindSetter(setSetting, 'ai_maxThinkingTokens'),
    showThinking: bindSetter(setSetting, 'ai_showThinking'),
    maxBudgetUsd: bindSetter(setSetting, 'ai_maxBudgetUsd'),
    compactModel: bindSetter(setSetting, 'ai_compactModel'),
    titleModel: bindSetter(setSetting, 'ai_titleModel'),
    permissionMode: bindSetter(setSetting, 'ai_permissionMode'),
    requirePlanApproval: bindSetter(setSetting, 'ai_requirePlanApproval'),
    cwdRestriction: bindSetter(setSetting, 'hooks_cwdRestriction'),
    cwdWhitelist: bindJsonSetter<CwdWhitelistEntry[]>(setSetting, 'hooks_cwdWhitelist'),
    sharedHooks: bindSetter(setSetting, 'settings_sharedAcrossBackends'),
    skills: bindSetter(setSetting, 'ai_skills'),
    skillsEnabled: bindSetter(setSetting, 'ai_skillsEnabled'),
    skillsIncludePlugins: bindSetter(setSetting, 'ai_skillsIncludePlugins'),
    disabledSkills: bindJsonSetter<string[]>(setSetting, 'ai_disabledSkills'),
    defaultSystemPrompt: bindSetter(setSetting, 'ai_defaultSystemPrompt'),
  }), [setSetting])

  return (
    <div className="flex flex-col gap-1">
      <IdentityBackendSection
        agentName={get('agent_name')}
        agentLanguage={get('agent_language')}
        agentPersonality={get('agent_personality')}
        sdkBackend={sdkBackend}
        isClaudeBackend={isClaudeBackend}
        piExtensionsDir={piExtensionsDir}
        piExtensions={piExtensions}
        piDisabledExtensions={piDisabledExtensions}
        onAgentNameChange={setters.agentName}
        onAgentLanguageChange={setters.agentLanguage}
        onAgentPersonalityChange={setters.agentPersonality}
        onSdkBackendChange={setters.sdkBackend}
        onPiExtensionsDirChange={setters.piExtensionsDir}
        onPiDisabledExtensionsChange={setters.piDisabledExtensions}
        onBrowseExtensionsDir={browseExtensionsDir}
      />

      {isClaudeBackend && (
        <CredentialsSection
          apiKey={apiKey}
          baseUrl={get('ai_baseUrl')}
          onApiKeyChange={handleApiKeyChange}
          onBaseUrlChange={setters.baseUrl}
        />
      )}

      <ModelSection
        model={displayModel}
        customModel={customModel}
        customModels={customModels}
        customModelContextLengths={customModelContextLengths}
        fetchedModels={fetchedModels}
        contextTokenCounter={get('ai_contextTokenCounter')}
        isClaudeBackend={isClaudeBackend}
        maxTurns={get('ai_maxTurns')}
        maxThinkingTokens={get('ai_maxThinkingTokens')}
        showThinking={get('ai_showThinking')}
        maxBudgetUsd={get('ai_maxBudgetUsd')}
        compactModel={mapForBackend(get('ai_compactModel'))}
        titleModel={mapForBackend(get('ai_titleModel'))}
        onModelChange={handleModelChange}
        onCustomModelInputChange={setters.customModel}
        onSaveCustomModel={saveCustomModel}
        onRemoveCustomModel={removeCustomModel}
        onSetCustomModelContextLength={setCustomModelContextLength}
        onContextTokenCounterChange={setters.contextTokenCounter}
        onMaxTurnsChange={setters.maxTurns}
        onMaxThinkingTokensChange={setters.maxThinkingTokens}
        onShowThinkingChange={setters.showThinking}
        onMaxBudgetUsdChange={setters.maxBudgetUsd}
        onCompactModelChange={setters.compactModel}
        onTitleModelChange={setters.titleModel}
      />

      <PermissionsSection
        permissionMode={get('ai_permissionMode')}
        requirePlanApproval={get('ai_requirePlanApproval')}
        cwdRestriction={get('hooks_cwdRestriction')}
        cwdWhitelist={cwdWhitelist}
        sharedHooks={get('settings_sharedAcrossBackends')}
        onPermissionModeChange={setters.permissionMode}
        onRequirePlanApprovalChange={setters.requirePlanApproval}
        onCwdRestrictionChange={setters.cwdRestriction}
        onCwdWhitelistChange={setters.cwdWhitelist}
        onSharedHooksChange={setters.sharedHooks}
      />

      <SkillsPromptSection
        skills={skills}
        skillsEnabled={get('ai_skillsEnabled')}
        skillsIncludePlugins={get('ai_skillsIncludePlugins')}
        disabledSkills={disabledSkills}
        discoveredSkills={discoveredSkills}
        skillsOverhead={skillsOverhead}
        defaultSystemPrompt={get('ai_defaultSystemPrompt')}
        onSkillsChange={setters.skills}
        onSkillsEnabledChange={setters.skillsEnabled}
        onSkillsIncludePluginsChange={setters.skillsIncludePlugins}
        onDisabledSkillsChange={setters.disabledSkills}
        onDefaultSystemPromptChange={setters.defaultSystemPrompt}
      />
    </div>
  )
}
