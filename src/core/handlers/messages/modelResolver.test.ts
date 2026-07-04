import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../__tests__/db-helper'
import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import { assembleAISettings } from './modelResolver'

// Helper: insert a global setting
function setSetting(db: SqlJsAdapter, key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

// Helper: insert folder and return its id
function makeFolder(db: SqlJsAdapter, overrides: Record<string, string> = {}): number {
  const r = db.prepare("INSERT INTO folders (name) VALUES ('TestFolder')").run()
  const folderId = r.lastInsertRowid as number
  if (Object.keys(overrides).length > 0) {
    db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify(overrides),
      folderId,
    )
  }
  return folderId
}

// Helper: insert conversation and return its id
function makeConv(
  db: SqlJsAdapter,
  folderId: number | null = null,
  overrides: Record<string, string> = {},
): number {
  const r = db.prepare("INSERT INTO conversations (title) VALUES ('Test Conv')").run()
  const convId = r.lastInsertRowid as number
  if (folderId !== null) {
    db.prepare('UPDATE conversations SET folder_id = ? WHERE id = ?').run(folderId, convId)
  }
  if (Object.keys(overrides).length > 0) {
    db.prepare('UPDATE conversations SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify(overrides),
      convId,
    )
  }
  return convId
}

describe('assembleAISettings', () => {
  let db: SqlJsAdapter
  let convId: number

  beforeEach(async () => {
    db = await createTestDb()
    convId = makeConv(db)
  })

  // ── model resolution ──────────────────────────────────────────

  describe('model resolution (resolveFinalModel)', () => {
    it('uses globalCustomModel when cascadedModel matches globalModel', () => {
      // seeded default is claude-sonnet-4-6; set same in global + custom
      setSetting(db, 'ai_model', 'claude-sonnet-4-6')
      setSetting(db, 'ai_customModel', 'my-custom-fork')
      convId = makeConv(db)
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.model).toBe('my-custom-fork')
    })

    it('uses cascadedModel when it differs from globalModel (folder override)', () => {
      setSetting(db, 'ai_model', 'claude-sonnet-4-6')
      setSetting(db, 'ai_customModel', 'should-be-ignored')
      const folderId = makeFolder(db, { ai_model: 'claude-opus-4' })
      convId = makeConv(db, folderId)
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.model).toBe('claude-opus-4')
    })

    it('uses cascadedModel when it differs from globalModel (conv override)', () => {
      setSetting(db, 'ai_model', 'claude-sonnet-4-6')
      setSetting(db, 'ai_customModel', 'ignored-custom')
      convId = makeConv(db, null, { ai_model: 'claude-haiku-4-5' })
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.model).toBe('claude-haiku-4-5')
    })

    it("drops 'custom' sentinel — returns undefined", () => {
      setSetting(db, 'ai_model', 'custom')
      // No ai_customModel set → rawModel = 'custom' → undefined
      convId = makeConv(db)
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.model).toBeUndefined()
    })

    it('returns undefined when neither global model nor custom model is set', () => {
      // Remove seed default
      db.prepare("DELETE FROM settings WHERE key = 'ai_model'").run()
      db.prepare("DELETE FROM settings WHERE key = 'ai_customModel'").run()
      convId = makeConv(db)
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.model).toBeUndefined()
    })

    it('falls back to globalModel when globalCustomModel is empty string', () => {
      setSetting(db, 'ai_model', 'claude-sonnet-4-6')
      setSetting(db, 'ai_customModel', '')
      convId = makeConv(db)
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      // empty string is falsy → globalModel used
      expect(s.model).toBe('claude-sonnet-4-6')
    })
  })

  // ── sdkBackend ────────────────────────────────────────────────

  describe('sdkBackend', () => {
    it('defaults to claude-agent-sdk', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.sdkBackend).toBe('claude-agent-sdk')
    })

    it('reads sdkBackend from global settings', () => {
      setSetting(db, 'ai_sdkBackend', 'pi')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.sdkBackend).toBe('pi')
    })

    it('cascades sdkBackend from folder overrides', () => {
      const folderId = makeFolder(db, { ai_sdkBackend: 'pi' })
      convId = makeConv(db, folderId)
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.sdkBackend).toBe('pi')
    })
  })

  // ── numeric fields ────────────────────────────────────────────

  describe('numeric field parsing', () => {
    it('parses maxTurns from settings', () => {
      setSetting(db, 'ai_maxTurns', '25')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.maxTurns).toBe(25)
    })

    it('returns undefined maxTurns when not set', () => {
      db.prepare("DELETE FROM settings WHERE key = 'ai_maxTurns'").run()
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.maxTurns).toBeUndefined()
    })

    it('parses maxThinkingTokens from settings', () => {
      setSetting(db, 'ai_maxThinkingTokens', '8000')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.maxThinkingTokens).toBe(8000)
    })

    it('returns 0 maxThinkingTokens when seeded to 0', () => {
      // seed sets ai_maxThinkingTokens to '0' — Number('0') = 0
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.maxThinkingTokens).toBe(0)
    })

    it('parses maxBudgetUsd from settings', () => {
      setSetting(db, 'ai_maxBudgetUsd', '1.5')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.maxBudgetUsd).toBe(1.5)
    })

    it('returns 0 maxBudgetUsd when seeded to 0', () => {
      // seed sets ai_maxBudgetUsd to '0' — Number('0') = 0
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.maxBudgetUsd).toBe(0)
    })

    it('parses ttsAutoWordLimit from settings', () => {
      setSetting(db, 'tts_autoWordLimit', '200')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.ttsAutoWordLimit).toBe(200)
    })

    it('returns undefined ttsAutoWordLimit when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.ttsAutoWordLimit).toBeUndefined()
    })
  })

  // ── boolean fields ────────────────────────────────────────────

  describe('boolean field parsing', () => {
    it('permissionMode defaults to bypassPermissions', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.permissionMode).toBe('bypassPermissions')
    })

    it('permissionMode reads from settings', () => {
      setSetting(db, 'ai_permissionMode', 'default')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.permissionMode).toBe('default')
    })

    it('requirePlanApproval defaults to true', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.requirePlanApproval).toBe(true)
    })

    it('requirePlanApproval reads false from settings', () => {
      setSetting(db, 'ai_requirePlanApproval', 'false')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.requirePlanApproval).toBe(false)
    })

    it('cwdRestrictionEnabled defaults to true', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.cwdRestrictionEnabled).toBe(true)
    })

    it('cwdRestrictionEnabled reads false from settings', () => {
      setSetting(db, 'hooks_cwdRestriction', 'false')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.cwdRestrictionEnabled).toBe(false)
    })

    it('sharedHooks defaults to true', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.sharedHooks).toBe(true)
    })

    it('sharedHooks reads false from settings', () => {
      setSetting(db, 'settings_sharedAcrossBackends', 'false')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.sharedHooks).toBe(false)
    })

    it('skillsEnabled defaults to true', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.skillsEnabled).toBe(true)
    })

    it('skillsEnabled reads false from settings', () => {
      setSetting(db, 'ai_skillsEnabled', 'false')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.skillsEnabled).toBe(false)
    })

    it('skillsIncludePlugins defaults to false', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.skillsIncludePlugins).toBe(false)
    })

    it('skillsIncludePlugins is always false (ai_skillsIncludePlugins not in AI_SETTING_KEYS)', () => {
      // ai_skillsIncludePlugins is not fetched from DB; the field always defaults to false
      setSetting(db, 'ai_skillsIncludePlugins', 'true')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.skillsIncludePlugins).toBe(false)
    })
  })

  // ── string/optional fields ────────────────────────────────────

  describe('optional string fields', () => {
    it('apiKey is undefined when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.apiKey).toBeUndefined()
    })

    it('apiKey reads from global settings', () => {
      setSetting(db, 'ai_apiKey', 'sk-test-123')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.apiKey).toBe('sk-test-123')
    })

    it('baseUrl is undefined when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.baseUrl).toBeUndefined()
    })

    it('baseUrl reads from global settings', () => {
      setSetting(db, 'ai_baseUrl', 'https://proxy.example.com')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.baseUrl).toBe('https://proxy.example.com')
    })

    it('ttsSummaryPrompt is undefined when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.ttsSummaryPrompt).toBeUndefined()
    })

    it('ttsSummaryPrompt reads from settings', () => {
      setSetting(db, 'tts_summaryPrompt', 'Summarise briefly')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.ttsSummaryPrompt).toBe('Summarise briefly')
    })

    it('ttsSummaryModel is undefined when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.ttsSummaryModel).toBeUndefined()
    })

    it('ttsSummaryModel reads from settings', () => {
      setSetting(db, 'tts_summaryModel', 'claude-haiku-4-5')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.ttsSummaryModel).toBe('claude-haiku-4-5')
    })

    it('compactModel is undefined when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.compactModel).toBeUndefined()
    })

    it('compactModel reads from settings', () => {
      setSetting(db, 'ai_compactModel', 'claude-haiku-4-5')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.compactModel).toBe('claude-haiku-4-5')
    })

    it('titleModel is undefined when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.titleModel).toBeUndefined()
    })

    it('titleModel reads from settings', () => {
      setSetting(db, 'ai_titleModel', 'claude-haiku-4-5')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.titleModel).toBe('claude-haiku-4-5')
    })

    it('webhookCompletionUrl is undefined when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.webhookCompletionUrl).toBeUndefined()
    })

    it('webhookCompletionUrl reads from settings', () => {
      setSetting(db, 'webhook_completionUrl', 'https://hooks.example.com/done')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.webhookCompletionUrl).toBe('https://hooks.example.com/done')
    })

    it('ttsResponseMode is undefined when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.ttsResponseMode).toBeUndefined()
    })

    it('ttsResponseMode reads from settings', () => {
      setSetting(db, 'tts_responseMode', 'summary')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.ttsResponseMode).toBe('summary')
    })

    it('piExtensionsDir is undefined when not set', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.piExtensionsDir).toBeUndefined()
    })

    it('piExtensionsDir reads from global settings', () => {
      setSetting(db, 'pi_extensionsDir', '/home/user/.pi/extensions')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.piExtensionsDir).toBe('/home/user/.pi/extensions')
    })
  })

  // ── tools config ──────────────────────────────────────────────

  describe('tools config', () => {
    it('defaults to preset claude_code', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.tools).toEqual({ type: 'preset', preset: 'claude_code' })
    })

    it('parses json array tools', () => {
      setSetting(db, 'ai_tools', JSON.stringify(['Bash', 'Read', 'Write']))
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.tools).toEqual(['Bash', 'Read', 'Write'])
    })

    it('uses preset when ai_tools value is preset:claude_code', () => {
      setSetting(db, 'ai_tools', 'preset:claude_code')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.tools).toEqual({ type: 'preset', preset: 'claude_code' })
    })

    it('falls back to preset for invalid json in ai_tools', () => {
      setSetting(db, 'ai_tools', '{invalid}')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.tools).toEqual({ type: 'preset', preset: 'claude_code' })
    })
  })

  // ── JSON-parsed arrays ────────────────────────────────────────

  describe('json-parsed array fields', () => {
    it('disabledSkills defaults to empty array', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.disabledSkills).toEqual([])
    })

    it('disabledSkills parses from settings', () => {
      setSetting(db, 'ai_disabledSkills', JSON.stringify(['skill-a', 'skill-b']))
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.disabledSkills).toEqual(['skill-a', 'skill-b'])
    })

    it('piDisabledExtensions defaults to empty array', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.piDisabledExtensions).toEqual([])
    })

    it('piDisabledExtensions parses from settings', () => {
      setSetting(db, 'pi_disabledExtensions', JSON.stringify(['ext-x']))
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.piDisabledExtensions).toEqual(['ext-x'])
    })

    it('cwdWhitelist defaults to empty array', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.cwdWhitelist).toEqual([])
    })

    it('cwdWhitelist parses from settings', () => {
      setSetting(
        db,
        'hooks_cwdWhitelist',
        JSON.stringify([{ path: '/data', access: 'read' }]),
      )
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.cwdWhitelist).toEqual([{ path: '/data', access: 'read' }])
    })
  })

  // ── skills field ──────────────────────────────────────────────

  describe('skills field', () => {
    it("defaults to 'off'", () => {
      db.prepare("DELETE FROM settings WHERE key = 'ai_skills'").run()
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.skills).toBe('off')
    })

    it("reads 'user' from settings", () => {
      setSetting(db, 'ai_skills', 'user')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.skills).toBe('user')
    })

    it("reads 'project' from settings", () => {
      setSetting(db, 'ai_skills', 'project')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.skills).toBe('project')
    })

    it("reads 'local' from settings", () => {
      setSetting(db, 'ai_skills', 'local')
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.skills).toBe('local')
    })
  })

  // ── cwd passthrough ───────────────────────────────────────────

  describe('cwd passthrough', () => {
    it('returns cwd from assembleOpts', () => {
      const s = assembleAISettings(db as any, convId, { cwd: '/workspace/myproject' })
      expect(s.cwd).toBe('/workspace/myproject')
    })
  })

  // ── MCP integration ───────────────────────────────────────────

  describe('MCP integration via assembleAISettings', () => {
    it('injects scheduler when callback returns config', () => {
      const s = assembleAISettings(db as any, convId, {
        cwd: '/tmp',
        getSchedulerMcpConfig: () => ({ command: 'node', args: ['sched.js'] }),
      })
      expect(s.mcpServers?.['agent_scheduler']).toBeDefined()
    })

    it('does NOT inject scheduler when callback returns null', () => {
      const s = assembleAISettings(db as any, convId, {
        cwd: '/tmp',
        getSchedulerMcpConfig: () => null,
      })
      expect(s.mcpServers?.['agent_scheduler']).toBeUndefined()
    })

    it('does NOT inject scheduler when sdkBackend is pi', () => {
      setSetting(db, 'ai_sdkBackend', 'pi')
      convId = makeConv(db)
      const s = assembleAISettings(db as any, convId, {
        cwd: '/tmp',
        getSchedulerMcpConfig: () => ({ command: 'node', args: [] }),
      })
      expect(s.mcpServers?.['agent_scheduler']).toBeUndefined()
    })
  })

  describe('cross-backend model mapping', () => {
    it('maps a stored PI Haiku id to the Claude model when backend is Claude', () => {
      setSetting(db, 'ai_model', 'anthropic/claude-3-5-haiku')
      convId = makeConv(db)
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.model).toBe('claude-haiku-4-5-20251001')
    })

    it('falls back to the last native Claude selection for a non-mappable PI model', () => {
      setSetting(db, 'ai_model', 'openai/gpt-4o')
      setSetting(db, 'ai_lastModelByBackend', JSON.stringify({ 'claude-agent-sdk': 'claude-opus-4-7' }))
      convId = makeConv(db)
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.model).toBe('claude-opus-4-7')
      expect(s.lastModelByBackend).toEqual({ 'claude-agent-sdk': 'claude-opus-4-7' })
    })

    it('leaves a native Claude id untouched (idempotent)', () => {
      setSetting(db, 'ai_model', 'claude-sonnet-4-6')
      convId = makeConv(db)
      const s = assembleAISettings(db as any, convId, { cwd: '/tmp' })
      expect(s.model).toBe('claude-sonnet-4-6')
    })
  })
})
