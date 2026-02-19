import { useEffect, useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAuthStore } from '../../stores/authStore'
import { MODEL_OPTIONS, DEFAULT_MODEL, SETTING_SOURCES_OPTIONS, SKILLS_TOGGLE_OPTIONS } from '../../../shared/constants'
import { SystemPromptEditorModal } from './SystemPromptEditorModal'

export function AISettings() {
  const { settings, loadSettings, setSetting } = useSettingsStore()
  const { checkAuth } = useAuthStore()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const apiKey = settings['ai_apiKey'] ?? ''
  const baseUrl = settings['ai_baseUrl'] ?? ''
  const customModel = settings['ai_customModel'] ?? ''
  const [showApiKey, setShowApiKey] = useState(false)

  const handleApiKeyChange = useCallback((value: string) => {
    setSetting('ai_apiKey', value)
    // Re-check auth status after a brief delay (API key auth is instant)
    setTimeout(() => checkAuth(), 300)
  }, [setSetting, checkAuth])

  const model = settings['ai_model'] ?? DEFAULT_MODEL
  const isCustomModel = !!customModel
  const maxTurns = settings['ai_maxTurns'] ?? '1'
  const maxThinkingTokens = settings['ai_maxThinkingTokens'] ?? '0'
  const maxBudgetUsd = settings['ai_maxBudgetUsd'] ?? '0'
  const permissionMode = settings['ai_permissionMode'] ?? 'bypassPermissions'
  const skills = settings['ai_skills'] ?? 'off'
  const cwdRestriction = settings['hooks_cwdRestriction'] ?? 'true'
  const defaultSystemPrompt = settings['ai_defaultSystemPrompt'] ?? ''
  const skillsEnabled = settings['ai_skillsEnabled'] ?? 'true'
  const disabledSkills: string[] = (() => {
    try { const arr = JSON.parse(settings['ai_disabledSkills'] || '[]'); return Array.isArray(arr) ? arr : [] } catch { return [] }
  })()
  const [discoveredSkills, setDiscoveredSkills] = useState<import('../../../shared/types').SlashCommand[]>([])
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [showPromptEditor, setShowPromptEditor] = useState(false)

  useEffect(() => {
    if (skills === 'off') {
      setDiscoveredSkills([])
      return
    }
    window.agent.commands.list(undefined, skills).then((cmds: import('../../../shared/types').SlashCommand[]) => {
      setDiscoveredSkills(cmds.filter(c => c.source === 'skill'))
    }).catch(() => setDiscoveredSkills([]))
  }, [skills])

  return (
    <div className="flex flex-col gap-1">
      {/* API Key */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            API Key
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Anthropic API key. Bypasses OAuth when set.
          </span>
        </div>
        <div className="flex items-center gap-1">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            placeholder="sk-ant-..."
            className="w-48 px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none font-mono"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            aria-label="API key"
          />
          <button
            onClick={() => setShowApiKey((v) => !v)}
            className="px-2 py-1.5 rounded text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            title={showApiKey ? 'Hide' : 'Show'}
          >
            {showApiKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Base URL (only when API key is set) */}
      {apiKey && (
        <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
          <div className="flex flex-col gap-0.5 pr-4">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Base URL
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Custom API endpoint (OpenRouter, proxy, etc).
            </span>
          </div>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setSetting('ai_baseUrl', e.target.value)}
            placeholder="https://api.anthropic.com"
            className="w-56 px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none font-mono"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            aria-label="Base URL"
          />
        </div>
      )}

      {/* Model */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Model
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Claude model used for responses.
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <select
            value={(isCustomModel || model === 'custom') ? 'custom' : model}
            onChange={(e) => {
              if (e.target.value === 'custom') {
                setSetting('ai_model', 'custom')
              } else {
                setSetting('ai_model', e.target.value)
                setSetting('ai_customModel', '') // clear custom model
              }
            }}
            className="px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
            }}
            aria-label="Select AI model"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            <option value="custom">Other</option>
          </select>
          {(isCustomModel || model === 'custom') && (
            <input
              type="text"
              value={customModel}
              onChange={(e) => setSetting('ai_customModel', e.target.value)}
              placeholder="anthropic/claude-3.5-sonnet"
              className="w-48 px-3 py-1.5 rounded text-xs border border-[var(--color-text-muted)]/20 outline-none font-mono"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
              aria-label="Custom model ID"
            />
          )}
        </div>
      </div>

      {/* Max Turns */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Max Turns
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Maximum agentic turns per request. 0 = unlimited.
          </span>
        </div>
        <input
          type="number"
          min={0}
          value={maxTurns}
          onChange={(e) => {
            const v = Math.max(0, Number(e.target.value) || 0)
            setSetting('ai_maxTurns', String(v))
          }}
          className="w-20 px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none text-right"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          aria-label="Maximum agentic turns"
        />
      </div>

      {/* Max Thinking Tokens */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Max Thinking Tokens
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Extended thinking budget. 0 = disabled (0-100000).
          </span>
        </div>
        <input
          type="number"
          min={0}
          max={100000}
          step={1000}
          value={maxThinkingTokens}
          onChange={(e) => {
            const v = Math.max(0, Math.min(100000, Number(e.target.value) || 0))
            setSetting('ai_maxThinkingTokens', String(v))
          }}
          className="w-24 px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none text-right"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          aria-label="Maximum thinking tokens"
        />
      </div>

      {/* Max Budget USD */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Max Budget (USD)
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Cost limit per request. 0 = unlimited (0-10).
          </span>
        </div>
        <input
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={maxBudgetUsd}
          onChange={(e) => {
            const v = Math.max(0, Math.min(10, Number(e.target.value) || 0))
            setSetting('ai_maxBudgetUsd', String(v))
          }}
          className="w-24 px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none text-right"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          aria-label="Maximum budget in USD"
        />
      </div>

      {/* Permission Mode */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Permission Mode
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Controls how the SDK handles tool permission prompts.
          </span>
        </div>
        <select
          value={permissionMode}
          onChange={(e) => setSetting('ai_permissionMode', e.target.value)}
          className="px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          aria-label="Select permission mode"
        >
          <option value="bypassPermissions">Bypass Permissions</option>
          <option value="acceptEdits">Accept Edits</option>
          <option value="default">Default</option>
          <option value="dontAsk">Don't Ask</option>
          <option value="plan">Plan Only</option>
        </select>
      </div>

      {/* Setting Sources */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Setting Sources
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Load Claude Code configuration from filesystem (settings.json, CLAUDE.md, skills, commands, hooks).
          </span>
        </div>
        <select
          value={skills}
          onChange={(e) => setSetting('ai_skills', e.target.value)}
          className="px-3 py-1.5 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          aria-label="Select setting sources"
        >
          {SETTING_SOURCES_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Skills Toggle */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)', opacity: skills === 'off' ? 0.5 : 1 }}>
            Skills
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: skills === 'off' ? 0.5 : 1 }}>
            Allow the AI to invoke discovered skills.
          </span>
        </div>
        <button
          onClick={() => setSetting('ai_skillsEnabled', skillsEnabled === 'true' ? 'false' : 'true')}
          disabled={skills === 'off'}
          className="relative w-10 h-5 rounded-full transition-colors"
          style={{
            backgroundColor: skillsEnabled === 'true' && skills !== 'off' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            opacity: skills === 'off' ? 0.3 : (skillsEnabled === 'true' ? 1 : 0.4),
          }}
          role="switch"
          aria-checked={skillsEnabled === 'true' && skills !== 'off'}
          aria-label="Toggle skills"
        >
          <span
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
            style={{
              left: skillsEnabled === 'true' && skills !== 'off' ? '1.25rem' : '0.125rem',
            }}
          />
        </button>
      </div>

      {/* Per-Skill List */}
      {skills !== 'off' && skillsEnabled === 'true' && discoveredSkills.length > 0 && (
        <div className="py-3 border-b border-[var(--color-text-muted)]/10">
          <span className="text-xs font-medium mb-2 block" style={{ color: 'var(--color-text-muted)' }}>
            Discovered Skills
          </span>
          <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
            {discoveredSkills.map((skill) => {
              const isDisabled = disabledSkills.includes(skill.name)
              return (
                <label
                  key={skill.name}
                  className="flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer hover:opacity-80"
                  style={{ color: 'var(--color-text)' }}
                >
                  <input
                    type="checkbox"
                    checked={!isDisabled}
                    onChange={() => {
                      const newDisabled = isDisabled
                        ? disabledSkills.filter(n => n !== skill.name)
                        : [...disabledSkills, skill.name]
                      setSetting('ai_disabledSkills', JSON.stringify(newDisabled))
                    }}
                    className="rounded"
                  />
                  <span className="flex-shrink-0">{skill.name}</span>
                  {skill.description && (
                    <span className="text-xs truncate min-w-0" style={{ color: 'var(--color-text-muted)' }}>
                      — {skill.description}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* CWD Restriction Hook */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            CWD Write Restriction
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Prompt before writing files outside the conversation working directory.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {confirmDisable && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-warning">
                Allows writing anywhere.
              </span>
              <button
                onClick={() => {
                  setSetting('hooks_cwdRestriction', 'false')
                  setConfirmDisable(false)
                }}
                className="px-2 py-0.5 rounded text-xs font-medium bg-warning text-base"
                aria-label="Confirm disable CWD restriction"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDisable(false)}
                className="px-2 py-0.5 rounded text-xs"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label="Cancel disable CWD restriction"
              >
                Cancel
              </button>
            </div>
          )}
          <button
            onClick={() => {
              if (cwdRestriction === 'true') {
                setConfirmDisable(true)
              } else {
                setSetting('hooks_cwdRestriction', 'true')
                setConfirmDisable(false)
              }
            }}
            className="relative w-10 h-5 rounded-full transition-colors"
            style={{
              backgroundColor: cwdRestriction === 'true' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              opacity: cwdRestriction === 'true' ? 1 : 0.4,
            }}
            role="switch"
            aria-checked={cwdRestriction === 'true'}
            aria-label="Toggle CWD write restriction"
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              style={{
                left: cwdRestriction === 'true' ? '1.25rem' : '0.125rem',
              }}
            />
          </button>
        </div>
      </div>

      {/* Default System Prompt */}
      <div className="flex flex-col gap-2 py-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Default System Prompt
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Global system prompt. Per-conversation prompts override this.
            </span>
          </div>
          <button
            onClick={() => setShowPromptEditor(true)}
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors hover:opacity-80"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              border: '1px solid color-mix(in srgb, var(--color-text-muted) 20%, transparent)',
            }}
            aria-label="Expand system prompt editor"
          >
            Expand ↗
          </button>
        </div>
        <textarea
          value={defaultSystemPrompt}
          onChange={(e) => setSetting('ai_defaultSystemPrompt', e.target.value)}
          rows={4}
          placeholder="Enter a default system prompt..."
          className="w-full px-3 py-2 rounded text-sm border border-[var(--color-text-muted)]/20 outline-none resize-y"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
          aria-label="Default system prompt"
        />
      </div>

      {showPromptEditor && (
        <SystemPromptEditorModal
          value={defaultSystemPrompt}
          onChange={(v) => setSetting('ai_defaultSystemPrompt', v)}
          onClose={() => setShowPromptEditor(false)}
        />
      )}
    </div>
  )
}
