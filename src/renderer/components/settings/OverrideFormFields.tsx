import { useState, type ReactNode } from 'react'
import { SETTING_DEFS, type McpServerName, type PIExtensionInfo } from '../../../shared/constants'
import { Checkbox } from '../ui/Checkbox'
import { SystemPromptEditorModal } from './SystemPromptEditorModal'
import { CwdWhitelistEditor } from './CwdWhitelistEditor'
import type { CwdWhitelistEntry } from '../../../shared/types'

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

// ─── Field Grouping ─────────────────────────────────────────

const FIELD_GROUPS = [
  { label: 'Model', keys: ['ai_sdkBackend', 'ai_model'] },
  { label: 'Limits', keys: ['ai_maxTurns', 'ai_maxThinkingTokens', 'ai_maxBudgetUsd'] },
  { label: 'Behavior', keys: ['ai_permissionMode', 'ai_skills', 'ai_skillsEnabled', 'hooks_sharedAcrossBackends'] },
  { label: 'Prompts & Files', keys: ['ai_defaultSystemPrompt', 'files_excludePatterns'] },
  { label: 'Voice', keys: ['tts_responseMode', 'tts_summaryPrompt'] },
]

const DEF_MAP = new Map(SETTING_DEFS.map(d => [d.key, d]))

// ─── Shared Sub-components ──────────────────────────────────

function ToggleButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 transition-opacity
        ${active ? 'bg-primary text-contrast' : 'bg-base text-muted opacity-30 group-hover:opacity-80 focus:opacity-80'}`}
    >
      {active ? 'Override' : 'Inherited'}
    </button>
  )
}

function FieldCard({ label, active, onToggle, wide, extra, children }: {
  label: string
  active: boolean
  onToggle: () => void
  wide?: boolean
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={`group flex flex-col gap-1 rounded-md px-3 py-2 transition-opacity
        ${wide ? 'col-span-3' : ''}
        ${!active ? 'cursor-pointer hover:opacity-80' : ''}`}
      style={{ backgroundColor: 'var(--color-bg)' }}
      onClick={!active ? onToggle : undefined}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className="text-[11px] font-medium truncate"
          style={{ color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}
        >
          {label}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {extra}
          {active && <ToggleButton active onClick={onToggle} />}
        </div>
      </div>
      {children}
    </div>
  )
}

function InheritedText({ value, source }: { value: string; source: string }) {
  return (
    <span className="text-[11px] truncate block" style={{ color: 'var(--color-text-muted)' }}>
      {value || '(default)'}
      <span className="opacity-40 ml-1">from {source}</span>
    </span>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-widest"
      style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}
    >
      {label}
    </span>
  )
}

// ─── Main Component ─────────────────────────────────────────

export function OverrideFormFields({
  draft,
  inheritedValues,
  inheritedSources,
  mcpServers,
  mcpDisabledDraft,
  mcpDisabledInherited,
  isMcpOverridden,
  onDraftChange,
  onToggleOverride,
  onToggleMcpOverride,
  onToggleMcpServer,
  cwdWhitelistDraft,
  cwdWhitelistInherited,
  isCwdWhitelistOverridden,
  onToggleCwdWhitelistOverride,
  onCwdWhitelistChange,
  piExtensions,
  piExtDisabledDraft,
  piExtDisabledInherited,
  isPiExtOverridden,
  onTogglePiExtOverride,
  onTogglePiExtension,
}: OverrideFormFieldsProps) {
  const [promptEditorKey, setPromptEditorKey] = useState<string | null>(null)

  const effectiveBackend = draft['ai_sdkBackend'] ?? inheritedValues['ai_sdkBackend'] ?? 'claude-agent-sdk'
  const isClaudeBackend = effectiveBackend !== 'pi'

  const inputStyle = {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    borderColor: 'var(--color-primary)',
  }

  const renderField = (key: string) => {
    const def = DEF_MAP.get(key)
    if (!def) return null
    if (def.claudeOnly && !isClaudeBackend) return null
    if (def.piOnly && isClaudeBackend) return null

    const active = draft[def.key] !== undefined
    const inherited = inheritedValues[def.key] || ''
    const source = inheritedSources?.[def.key] || 'Global'
    const isTextarea = def.type === 'textarea'

    const expandButton = active && isTextarea ? (
      <button
        onClick={() => setPromptEditorKey(def.key)}
        className="text-[9px] hover:opacity-80"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Expand ↗
      </button>
    ) : undefined

    return (
      <FieldCard
        key={def.key}
        label={def.label}
        active={active}
        onToggle={() => onToggleOverride(def.key)}
        wide={isTextarea}
        extra={expandButton}
      >
        {active ? (
          isTextarea ? (
            <>
              <textarea
                value={draft[def.key] || ''}
                onChange={(e) => onDraftChange(def.key, e.target.value)}
                rows={3}
                placeholder={`Enter ${def.label.toLowerCase()}...`}
                className="w-full px-2 py-1 rounded text-xs border outline-none resize-y"
                style={inputStyle}
              />
              {promptEditorKey === def.key && (
                <SystemPromptEditorModal
                  value={draft[def.key] || ''}
                  onChange={(v) => onDraftChange(def.key, v)}
                  onClose={() => setPromptEditorKey(null)}
                />
              )}
            </>
          ) : def.type === 'select' ? (
            <select
              value={draft[def.key] || ''}
              onChange={(e) => onDraftChange(def.key, e.target.value)}
              className="w-full px-2 py-1 rounded text-xs border outline-none"
              style={inputStyle}
            >
              {def.options!.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={def.min}
              max={def.max}
              step={def.step}
              value={draft[def.key] || ''}
              onChange={(e) => onDraftChange(def.key, e.target.value)}
              className="w-full px-2 py-1 rounded text-xs border outline-none"
              style={inputStyle}
            />
          )
        ) : (
          <InheritedText value={inherited} source={source} />
        )}
      </FieldCard>
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

      {/* Advanced section */}
      <div className="flex flex-col gap-1.5">
        <SectionHeader label="Advanced" />
        <div className="grid grid-cols-3 gap-2">
          {/* MCP Servers (Claude only) */}
          {isClaudeBackend && mcpServers.length > 0 && (
            isMcpOverridden ? (
              <FieldCard
                label="MCP Servers"
                active
                onToggle={onToggleMcpOverride}
                wide
              >
                <div
                  className="flex flex-col gap-0.5 rounded px-1 py-1 max-h-[120px] overflow-y-auto"
                  style={{ backgroundColor: 'var(--color-surface)' }}
                  role="group"
                  aria-label="MCP server toggles"
                >
                  {mcpServers.map((server) => {
                    const serverActive = !mcpDisabledDraft.includes(server.name)
                    return (
                      <button
                        key={server.name}
                        onClick={() => onToggleMcpServer(server.name)}
                        className="flex items-center gap-2 py-0.5 text-xs text-left hover:opacity-80"
                        style={{ color: 'var(--color-text)' }}
                        role="checkbox"
                        aria-checked={serverActive}
                      >
                        <Checkbox checked={serverActive} />
                        <span style={{ opacity: serverActive ? 1 : 0.5 }}>{server.name}</span>
                      </button>
                    )
                  })}
                </div>
              </FieldCard>
            ) : (
              <FieldCard label="MCP Servers" active={false} onToggle={onToggleMcpOverride}>
                <InheritedText
                  value={mcpDisabledInherited.length > 0
                    ? `${mcpServers.length - mcpDisabledInherited.length}/${mcpServers.length} enabled`
                    : `All ${mcpServers.length} enabled`}
                  source={inheritedSources?.['ai_mcpDisabled'] || 'Global'}
                />
              </FieldCard>
            )
          )}

          {/* CWD Restriction (Claude only) */}
          {isClaudeBackend && (draft['hooks_cwdRestriction'] !== undefined ? (
            <FieldCard
              label="CWD Restriction"
              active
              onToggle={() => onToggleOverride('hooks_cwdRestriction')}
              wide
            >
              <button
                onClick={() => onDraftChange('hooks_cwdRestriction', draft['hooks_cwdRestriction'] === 'true' ? 'false' : 'true')}
                className="flex items-center gap-2 px-2 py-1 rounded text-xs"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                role="switch"
                aria-checked={draft['hooks_cwdRestriction'] === 'true'}
              >
                <span
                  className="relative w-8 h-4 rounded-full transition-colors flex-shrink-0"
                  style={{
                    backgroundColor: draft['hooks_cwdRestriction'] === 'true' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    opacity: draft['hooks_cwdRestriction'] === 'true' ? 1 : 0.4,
                  }}
                >
                  <span
                    className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                    style={{ left: draft['hooks_cwdRestriction'] === 'true' ? '1rem' : '0.125rem' }}
                  />
                </span>
                <span style={{ opacity: 0.8 }}>
                  {draft['hooks_cwdRestriction'] === 'true' ? 'Enabled' : 'Disabled'}
                </span>
              </button>
            </FieldCard>
          ) : (
            <FieldCard label="CWD Restriction" active={false} onToggle={() => onToggleOverride('hooks_cwdRestriction')}>
              <InheritedText
                value={(inheritedValues['hooks_cwdRestriction'] ?? 'true') === 'true' ? 'Enabled' : 'Disabled'}
                source={inheritedSources?.['hooks_cwdRestriction'] || 'Global'}
              />
            </FieldCard>
          ))}

          {/* CWD Whitelist (Claude only) */}
          {isClaudeBackend && onToggleCwdWhitelistOverride && (
            isCwdWhitelistOverridden ? (
              <FieldCard
                label="CWD Whitelist"
                active
                onToggle={onToggleCwdWhitelistOverride}
                wide
              >
                <CwdWhitelistEditor entries={cwdWhitelistDraft ?? []} onChange={onCwdWhitelistChange!} />
              </FieldCard>
            ) : (
              <FieldCard label="CWD Whitelist" active={false} onToggle={onToggleCwdWhitelistOverride!}>
                <InheritedText
                  value={(cwdWhitelistInherited ?? []).length > 0
                    ? `${(cwdWhitelistInherited ?? []).length} entries`
                    : 'No entries'}
                  source={inheritedSources?.['hooks_cwdWhitelist'] || 'Global'}
                />
              </FieldCard>
            )
          )}

          {/* PI Extensions (PI only) */}
          {!isClaudeBackend && onTogglePiExtOverride && piExtensions && piExtensions.length > 0 && (
            isPiExtOverridden ? (
              <FieldCard
                label="PI Extensions"
                active
                onToggle={onTogglePiExtOverride}
                wide
              >
                <div
                  className="flex flex-col gap-0.5 rounded px-1 py-1 max-h-[120px] overflow-y-auto"
                  style={{ backgroundColor: 'var(--color-surface)' }}
                  role="group"
                  aria-label="PI extension toggles"
                >
                  {piExtensions.map((ext) => {
                    const extActive = !(piExtDisabledDraft || []).includes(ext.path)
                    return (
                      <button
                        key={ext.path}
                        onClick={() => onTogglePiExtension?.(ext.path)}
                        className="flex items-center gap-2 py-0.5 text-xs text-left hover:opacity-80"
                        style={{ color: 'var(--color-text)' }}
                        role="checkbox"
                        aria-checked={extActive}
                      >
                        <Checkbox checked={extActive} />
                        <span style={{ opacity: extActive ? 1 : 0.5 }}>{ext.name}</span>
                      </button>
                    )
                  })}
                </div>
              </FieldCard>
            ) : (
              <FieldCard label="PI Extensions" active={false} onToggle={onTogglePiExtOverride}>
                <InheritedText
                  value={(piExtDisabledInherited || []).length > 0
                    ? `${piExtensions.length - (piExtDisabledInherited || []).length}/${piExtensions.length} enabled`
                    : `All ${piExtensions.length} enabled`}
                  source={inheritedSources?.['pi_disabledExtensions'] || 'Global'}
                />
              </FieldCard>
            )
          )}
        </div>
      </div>
    </div>
  )
}
