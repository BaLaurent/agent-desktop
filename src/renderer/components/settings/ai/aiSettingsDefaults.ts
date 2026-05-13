/**
 * Pure helpers for resolving settings with their defaults.
 * Extracted to keep AISettings.tsx free of `??` cyclomatic noise.
 */

const DEFAULTS: Record<string, string> = {
  ai_sdkBackend: 'claude-agent-sdk',
  ai_apiKey: '',
  ai_baseUrl: '',
  ai_customModel: '',
  ai_contextTokenCounter: 'local',
  ai_maxTurns: '1',
  ai_maxThinkingTokens: '0',
  ai_showThinking: 'false',
  ai_maxBudgetUsd: '0',
  ai_permissionMode: 'bypassPermissions',
  ai_requirePlanApproval: 'true',
  ai_skills: 'off',
  ai_skillsEnabled: 'true',
  ai_skillsIncludePlugins: 'false',
  ai_compactModel: '',
  ai_titleModel: '',
  ai_defaultSystemPrompt: '',
  hooks_cwdRestriction: 'true',
  settings_sharedAcrossBackends: 'true',
  agent_name: '',
  agent_language: '',
  agent_personality: '',
  pi_extensionsDir: '',
}

/**
 * Resolve a settings key with its hardcoded default.
 * Returns '' for unknown keys instead of undefined.
 */
export function resolveSetting(settings: Record<string, string | undefined>, key: string): string {
  const v = settings[key]
  if (v !== undefined) return v
  return DEFAULTS[key] ?? ''
}

/**
 * Parse a JSON-encoded array setting; returns [] on missing or malformed input.
 */
export function parseJsonArraySetting<T = string>(raw: string | undefined): T[] {
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? (arr as T[]) : []
  } catch {
    return []
  }
}
