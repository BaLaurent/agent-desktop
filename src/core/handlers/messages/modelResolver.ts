// AI settings assembly + model resolution for `getAISettings`.
//
// The cascaded value of `ai_model` already reflects Conversation > Folder
// > Global. We need to distinguish "user explicitly chose a model" from
// "user is on the global default" because only the latter promotes the
// `ai_customModel` free-text field to the effective model.
//
// Logic:
//   1. cascadedModel === globalModel → user has not overridden → use
//      `ai_customModel` if present, else fall back to `ai_model`.
//   2. cascadedModel !== globalModel → user picked something at the
//      folder/conversation level → trust the cascaded value.
//   3. The literal sentinel `'custom'` means "see ai_customModel"; if
//      it leaked through after step 2 we drop it (returns undefined).

import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import type { AISettings } from '../../services/streaming'
import type { CwdWhitelistEntry } from '../../types/types'
import { safeJsonParse } from '../../utils/json'
import { mapModelToBackend, parseLastModelByBackend } from '../../services/modelBackendMap'
import { applyCascadeOnto } from './cascade'
import { mergeKnowledgeFoldersIntoWhitelist } from './knowledgeBase'
import { loadMcpServersFromDb, filterDisabledMcpServers, injectSchedulerMcp } from './mcpServers'

interface ModelInputs {
  /** Final cascaded value of `ai_model` (Conv > Folder > Global). */
  cascadedModel: string | undefined
  /** Global `ai_model` row before any cascading. */
  globalModel: string | undefined
  /** Global `ai_customModel` row (free-text custom model name). */
  globalCustomModel: string | undefined
}

function resolveFinalModel(inputs: ModelInputs): string | undefined {
  const { cascadedModel, globalModel, globalCustomModel } = inputs
  const modelWasOverridden = cascadedModel !== globalModel
  const rawModel = modelWasOverridden
    ? cascadedModel
    : (globalCustomModel || globalModel || undefined)
  return rawModel === 'custom' ? undefined : rawModel
}

// ─── AI Settings assembly ─────────────────────────────────────

const AI_SETTING_KEYS = [
  'ai_sdkBackend', 'ai_model', 'ai_maxTurns', 'ai_maxThinkingTokens', 'ai_maxBudgetUsd',
  'ai_permissionMode', 'ai_requirePlanApproval', 'ai_tools',
  'hooks_cwdRestriction', 'hooks_cwdWhitelist',
  'settings_sharedAcrossBackends', 'ai_knowledgeFolders',
  'ai_skills', 'ai_skillsEnabled', 'ai_disabledSkills',
  'pi_disabledExtensions', 'pi_extensionsDir',
  'ai_apiKey', 'ai_baseUrl', 'ai_customModel', 'ai_lastModelByBackend',
  'tts_responseMode', 'tts_autoWordLimit', 'tts_summaryPrompt', 'tts_summaryModel',
  'ai_compactModel', 'ai_titleModel',
  'webhook_completionUrl',
] as const

function loadGlobalSettingsMap(db: SqlJsAdapter): Record<string, string> {
  const rows = (db as any)
    .prepare(`SELECT key, value FROM settings WHERE key IN (${AI_SETTING_KEYS.map(() => '?').join(',')})`)
    .all(...AI_SETTING_KEYS) as { key: string; value: string }[]
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return map
}

function parseToolsConfig(toolsValue: string | undefined): AISettings['tools'] {
  const value = toolsValue || 'preset:claude_code'
  if (value === 'preset:claude_code') return { type: 'preset', preset: 'claude_code' }
  const parsed = safeJsonParse<string[] | null>(value, null)
  return parsed ?? { type: 'preset', preset: 'claude_code' }
}

function buildMcpServerSet(
  db: SqlJsAdapter,
  conversationId: number,
  map: Record<string, string>,
  sdkBackend: string,
  getSchedulerMcpConfig: ((id: number) => Record<string, unknown> | null) | undefined,
): AISettings['mcpServers'] {
  let servers = loadMcpServersFromDb(db)
  servers = filterDisabledMcpServers(servers, map['ai_mcpDisabled'])
  injectSchedulerMcp(servers, sdkBackend, conversationId, getSchedulerMcpConfig)
  return servers
}

interface AssembleOptions {
  cwd: string
  knowledgesDir?: string
  getSchedulerMcpConfig?: (id: number) => Record<string, unknown> | null
}

/**
 * Assemble the full `AISettings` for a conversation. Pure data assembly:
 * the caller supplies the resolved `cwd` (computed via the cwd cache in
 * messages.ts) so this helper has no I/O dependency on filesystem state.
 *
 * Cascade order is enforced by `applyCascadeOnto`: Folder overrides
 * applied first, then Conversation overrides on top — Conv > Folder >
 * Global per CLAUDE.md > "Settings cascade".
 */
export function assembleAISettings(
  db: SqlJsAdapter,
  conversationId: number,
  assembleOpts: AssembleOptions,
): AISettings {
  const map = loadGlobalSettingsMap(db)

  const globalApiKey = map['ai_apiKey'] || undefined
  const globalBaseUrl = map['ai_baseUrl'] || undefined
  const globalCustomModel = map['ai_customModel'] || undefined
  const globalModel = map['ai_model'] || undefined
  const globalPiExtensionsDir = map['pi_extensionsDir'] || undefined

  const convRow = (db as any)
    .prepare('SELECT folder_id, ai_overrides FROM conversations WHERE id = ?')
    .get(conversationId) as { folder_id: number | null; ai_overrides: string | null } | undefined

  applyCascadeOnto(map, db, convRow?.folder_id ?? null, convRow?.ai_overrides ?? null)

  const cwdWhitelist = safeJsonParse<CwdWhitelistEntry[]>(map['hooks_cwdWhitelist'] || '[]', [])
  mergeKnowledgeFoldersIntoWhitelist(cwdWhitelist, map['ai_knowledgeFolders'], assembleOpts.knowledgesDir)

  const sdkBackend = map['ai_sdkBackend'] || 'claude-agent-sdk'
  const mcpServers = buildMcpServerSet(db, conversationId, map, sdkBackend, assembleOpts.getSchedulerMcpConfig)

  const finalModel = resolveFinalModel({
    cascadedModel: map['ai_model'] || undefined,
    globalModel,
    globalCustomModel,
  })

  // Adapt the stored id to the active backend's naming convention.
  // Non-destructive: `ai_model` stays as-is; only the effective value
  // handed to the SDK is translated (reversible on backend switch).
  const lastModelByBackend = parseLastModelByBackend(map['ai_lastModelByBackend'])
  const mappedModel = mapModelToBackend(finalModel, sdkBackend, { lastModelByBackend })

  return {
    sdkBackend,
    model: mappedModel,
    lastModelByBackend,
    maxTurns: map['ai_maxTurns'] ? Number(map['ai_maxTurns']) : undefined,
    maxThinkingTokens: map['ai_maxThinkingTokens'] ? Number(map['ai_maxThinkingTokens']) : undefined,
    maxBudgetUsd: map['ai_maxBudgetUsd'] ? Number(map['ai_maxBudgetUsd']) : undefined,
    cwd: assembleOpts.cwd,
    tools: parseToolsConfig(map['ai_tools']),
    permissionMode: map['ai_permissionMode'] || 'bypassPermissions',
    requirePlanApproval: (map['ai_requirePlanApproval'] ?? 'true') === 'true',
    mcpServers,
    cwdRestrictionEnabled: (map['hooks_cwdRestriction'] ?? 'true') === 'true',
    cwdWhitelist,
    sharedHooks: (map['settings_sharedAcrossBackends'] ?? 'true') === 'true',
    skills: (map['ai_skills'] as 'off' | 'user' | 'project' | 'local') || 'off',
    skillsEnabled: (map['ai_skillsEnabled'] ?? 'true') === 'true',
    disabledSkills: safeJsonParse<string[]>(map['ai_disabledSkills'] || '[]', []),
    skillsIncludePlugins: (map['ai_skillsIncludePlugins'] ?? 'false') === 'true',
    apiKey: globalApiKey,
    baseUrl: globalBaseUrl,
    ttsResponseMode: (map['tts_responseMode'] as 'off' | 'full' | 'summary' | 'auto') || undefined,
    ttsAutoWordLimit: map['tts_autoWordLimit'] ? Number(map['tts_autoWordLimit']) : undefined,
    ttsSummaryPrompt: map['tts_summaryPrompt'] || undefined,
    ttsSummaryModel: map['tts_summaryModel'] || undefined,
    compactModel: map['ai_compactModel'] || undefined,
    titleModel: map['ai_titleModel'] || undefined,
    piDisabledExtensions: safeJsonParse<string[]>(map['pi_disabledExtensions'] || '[]', []),
    piExtensionsDir: globalPiExtensionsDir,
    webhookCompletionUrl: map['webhook_completionUrl'] || undefined,
  }
}
