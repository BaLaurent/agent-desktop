import type { AIOverrides } from './types'

// ─── SDK Backend Constants ──────────────────────────────────

export const SDK_BACKEND_OPTIONS = [
  { value: 'claude-agent-sdk', label: 'Claude Agent SDK' },
  { value: 'pi', label: 'PI Coding Agent' },
] as const

export const BACKEND_DISPLAY_NAMES: Record<string, string> = {
  'claude-agent-sdk': 'Claude',
  'pi': 'PI',
}

/**
 * The assistant's effective display name: the user-set name, else the backend's
 * default (Claude / PI), else 'Claude'. Single source of truth for both the
 * renderer (useAgentDisplayName) and core (voice intent classifier).
 */
export function resolveAgentDisplayName(name?: string, backend?: string): string {
  return name || BACKEND_DISPLAY_NAMES[backend ?? 'claude-agent-sdk'] || 'Claude'
}

// ─── Model Constants ─────────────────────────────────────────

export const DEFAULT_MODEL = 'claude-sonnet-4-6'
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

export const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

export function shortenModelName(model: string): string {
  return model.replace('claude-', '').replace(/-\d{8}$/, '')
}

/** Parse the persisted JSON string[] of custom model IDs */
export function parseCustomModels(json: string | undefined): string[] {
  if (!json) return []
  try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr : [] }
  catch { return [] }
}

/**
 * Parse the per-custom-model context length map from `ai_customModelContextLengths`.
 * Format: `{"model-id": 1000000, "other": 200000}`.
 * Returns an empty object on malformed input.
 */
export function parseCustomModelContextLengths(json: string | undefined): Record<string, number> {
  if (!json) return {}
  try {
    const obj = JSON.parse(json)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && v > 0) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** baseModels (defaults to MODEL_OPTIONS) + saved custom models (for dropdowns) */
export function buildModelOptions(
  customModels: string[],
  baseModels: readonly { value: string; label: string }[] = MODEL_OPTIONS,
): { value: string; label: string }[] {
  return [
    ...baseModels.map(o => ({ value: o.value, label: o.label })),
    ...customModels.map(m => ({ value: m, label: shortenModelName(m) })),
  ]
}

// ─── Permission Mode Constants ───────────────────────────────

export const PERMISSION_OPTIONS = [
  { value: 'bypassPermissions', label: 'Bypass' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'default', label: 'Default' },
  { value: 'dontAsk', label: "Don't Ask" },
  { value: 'plan', label: 'Plan Only' },
] as const

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_OPTIONS.map((o) => [o.value, o.label])
)

// ─── Setting Sources Options ────────────────────────────────

export const SETTING_SOURCES_OPTIONS = [
  { value: 'off', label: 'Disabled' },
  { value: 'user', label: 'User (~/.claude/)' },
  { value: 'project', label: 'User + Project (.claude/)' },
  { value: 'local', label: 'User + Project + Local' },
] as const

const SKILLS_TOGGLE_OPTIONS = [
  { value: 'true', label: 'Enabled' },
  { value: 'false', label: 'Disabled' },
] as const

const PLAN_APPROVAL_OPTIONS = [
  { value: 'true', label: 'Always ask' },
  { value: 'false', label: 'Auto-approve (bypass)' },
] as const

export const CONFIG_SHARING_OPTIONS = [
  { value: 'true', label: 'Shared' },
  { value: 'false', label: 'Per-backend' },
] as const

// ─── TTS Response Options ───────────────────────────────────

const TTS_RESPONSE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'full', label: 'Full Response' },
  { value: 'summary', label: 'Summary' },
  { value: 'auto', label: 'Auto (Full or Summary)' },
] as const

// ─── AI Override Setting Definitions ─────────────────────────

export interface SettingDef {
  key: keyof AIOverrides
  label: string
  type: 'select' | 'number' | 'textarea'
  options?: readonly { readonly value: string; readonly label: string }[]
  min?: number
  max?: number
  step?: number
  claudeOnly?: boolean
  piOnly?: boolean
}

export interface PIExtensionInfo {
  name: string   // filename without .ts/.js extension
  path: string   // resolvedPath from PI SDK Extension
}

export const SETTING_DEFS: SettingDef[] = [
  { key: 'agent_name', label: 'Agent Name', type: 'textarea' },
  { key: 'agent_personality', label: 'Personality', type: 'textarea' },
  { key: 'agent_language', label: 'Language', type: 'textarea' },
  { key: 'ai_sdkBackend', label: 'Backend', type: 'select', options: SDK_BACKEND_OPTIONS },
  { key: 'ai_model', label: 'Model', type: 'select', options: MODEL_OPTIONS },
  { key: 'ai_maxTurns', label: 'Max Turns', type: 'number', min: 0 },
  { key: 'ai_maxThinkingTokens', label: 'Thinking Tokens', type: 'number', min: 0, max: 100000, step: 1000 },
  { key: 'ai_maxBudgetUsd', label: 'Budget (USD)', type: 'number', min: 0, max: 10, step: 0.1 },
  { key: 'ai_permissionMode', label: 'Permission Mode', type: 'select', options: PERMISSION_OPTIONS },
  { key: 'ai_requirePlanApproval', label: 'Plan Approval', type: 'select', options: PLAN_APPROVAL_OPTIONS },
  { key: 'ai_skills', label: 'Setting Sources', type: 'select', options: SETTING_SOURCES_OPTIONS },
  { key: 'ai_skillsEnabled', label: 'Skills', type: 'select', options: SKILLS_TOGGLE_OPTIONS },
  { key: 'ai_skillsIncludePlugins', label: 'Include Installed Plugin Skills', type: 'select', options: CONFIG_SHARING_OPTIONS },
  { key: 'ai_defaultSystemPrompt', label: 'System Prompt', type: 'textarea' },
  { key: 'settings_sharedAcrossBackends', label: 'Share Claude Config', type: 'select', options: CONFIG_SHARING_OPTIONS },
  { key: 'files_excludePatterns', label: 'File Exclude Patterns', type: 'textarea' },
  { key: 'tts_responseMode', label: 'Response TTS', type: 'select', options: TTS_RESPONSE_OPTIONS },
  { key: 'tts_summaryPrompt', label: 'TTS Summary Prompt', type: 'textarea' },
  { key: 'webhook_completionUrl', label: 'Completion Webhook', type: 'textarea' },
]

// ─── AI Override Keys ────────────────────────────────────────

export const AI_OVERRIDE_KEYS: (keyof AIOverrides)[] = [
  'ai_sdkBackend',
  'ai_model',
  'ai_maxTurns',
  'ai_maxThinkingTokens',
  'ai_showThinking',
  'ai_maxBudgetUsd',
  'ai_permissionMode',
  'ai_requirePlanApproval',
  'ai_tools',
  'ai_defaultSystemPrompt',
  'ai_mcpDisabled',
  'ai_knowledgeFolders',
  'ai_skills',
  'ai_skillsEnabled',
  'ai_disabledSkills',
  'ai_skillsIncludePlugins',
  'pi_disabledExtensions',
  'hooks_cwdWhitelist',
  'settings_sharedAcrossBackends',
  'files_excludePatterns',
  'tts_responseMode',
  'tts_summaryPrompt',
  'agent_name',
  'agent_personality',
  'agent_language',
  'webhook_completionUrl',
]

// ─── File Exclude Patterns ──────────────────────────────────

export const DEFAULT_EXCLUDE_PATTERNS = 'node_modules,venv,.venv,__pycache__,dist,build,.next,.nuxt,target,.cache,.tox,.mypy_cache,.pytest_cache,.eggs,.gradle,.cargo,vendor,.turbo,.parcel-cache,coverage'

// ─── Notification Event Definitions ─────────────────────────

import type { NotificationConfig } from './types'

export const NOTIFICATION_EVENTS = [
  { key: 'success', label: 'Completed' },
  { key: 'max_tokens', label: 'Token limit reached' },
  { key: 'refusal', label: 'Request declined' },
  { key: 'error_max_turns', label: 'Max turns reached' },
  { key: 'error_max_budget', label: 'Budget exceeded' },
  { key: 'error_execution', label: 'Execution error' },
  { key: 'error_js', label: 'System error' },
] as const

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  success:          { sound: true, desktop: true },
  max_tokens:       { sound: true, desktop: true },
  refusal:          { sound: true, desktop: true },
  error_max_turns:  { sound: true, desktop: true },
  error_max_budget: { sound: true, desktop: true },
  error_execution:  { sound: true, desktop: true },
  error_js:         { sound: true, desktop: false },
}

// ─── MCP Server Name Interface ───────────────────────────────

export interface McpServerName {
  name: string
}

// ─── Web Transport Protocol ──────────────────────────────────

/**
 * Rejection message the web WebSocket shim uses for in-flight RPCs when the
 * socket closes. Shared so the renderer can recognise a transport drop (and
 * treat it as recoverable "reconnecting" rather than a fatal error) while the
 * shim that emits it stays in lock-step. The shim interpolates this value into
 * its generated source; chatStore matches against it.
 */
export const WS_DISCONNECTED_MESSAGE = 'WebSocket disconnected'
