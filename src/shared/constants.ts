import type { AIOverrides } from './types'

// ─── Model Constants ─────────────────────────────────────────

export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

export const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

export function shortenModelName(model: string): string {
  return model.replace('claude-', '').replace(/-\d{8}$/, '')
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

// ─── Skills Options ─────────────────────────────────────────

export const SKILLS_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'user', label: 'User' },
  { value: 'project', label: 'User + Project' },
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
}

export const SETTING_DEFS: SettingDef[] = [
  { key: 'ai_model', label: 'Model', type: 'select', options: MODEL_OPTIONS },
  { key: 'ai_maxTurns', label: 'Max Turns', type: 'number', min: 0 },
  { key: 'ai_maxThinkingTokens', label: 'Thinking Tokens', type: 'number', min: 0, max: 100000, step: 1000 },
  { key: 'ai_maxBudgetUsd', label: 'Budget (USD)', type: 'number', min: 0, max: 10, step: 0.1 },
  { key: 'ai_permissionMode', label: 'Permission Mode', type: 'select', options: PERMISSION_OPTIONS },
  { key: 'ai_skills', label: 'Skills', type: 'select', options: SKILLS_OPTIONS },
  { key: 'ai_defaultSystemPrompt', label: 'System Prompt', type: 'textarea' },
  { key: 'files_excludePatterns', label: 'File Exclude Patterns', type: 'textarea' },
]

// ─── AI Override Keys ────────────────────────────────────────

export const AI_OVERRIDE_KEYS: (keyof AIOverrides)[] = [
  'ai_model',
  'ai_maxTurns',
  'ai_maxThinkingTokens',
  'ai_maxBudgetUsd',
  'ai_permissionMode',
  'ai_tools',
  'ai_defaultSystemPrompt',
  'ai_mcpDisabled',
  'ai_knowledgeFolders',
  'ai_skills',
  'files_excludePatterns',
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
