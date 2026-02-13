import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { MODEL_OPTIONS, DEFAULT_MODEL, SKILLS_OPTIONS } from '../../../shared/constants'

export function AISettings() {
  const { settings, loadSettings, setSetting } = useSettingsStore()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const model = settings['ai_model'] ?? DEFAULT_MODEL
  const maxTurns = settings['ai_maxTurns'] ?? '1'
  const maxThinkingTokens = settings['ai_maxThinkingTokens'] ?? '0'
  const maxBudgetUsd = settings['ai_maxBudgetUsd'] ?? '0'
  const permissionMode = settings['ai_permissionMode'] ?? 'bypassPermissions'
  const skills = settings['ai_skills'] ?? 'off'
  const cwdRestriction = settings['hooks_cwdRestriction'] ?? 'true'
  const defaultSystemPrompt = settings['ai_defaultSystemPrompt'] ?? ''
  const [confirmDisable, setConfirmDisable] = useState(false)

  return (
    <div className="flex flex-col gap-1">
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
        <select
          value={model}
          onChange={(e) => setSetting('ai_model', e.target.value)}
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
        </select>
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

      {/* Skills */}
      <div className="flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Skills
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Load Claude Code skills from filesystem directories.
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
          aria-label="Select skills mode"
        >
          {SKILLS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

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
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Default System Prompt
          </span>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Global system prompt. Per-conversation prompts override this.
          </span>
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
    </div>
  )
}
