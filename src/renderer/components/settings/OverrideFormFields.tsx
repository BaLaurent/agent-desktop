import { useState } from 'react'
import { SETTING_DEFS, type McpServerName } from '../../../shared/constants'
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
}

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
}: OverrideFormFieldsProps) {
  const [promptEditorKey, setPromptEditorKey] = useState<string | null>(null)

  return (
    <>
      {SETTING_DEFS.map((def) => {
        const active = draft[def.key] !== undefined
        const inherited = inheritedValues[def.key] || ''
        const source = inheritedSources?.[def.key] || 'Global'

        return (
          <div key={def.key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                {def.label}
              </label>
              <div className="flex items-center gap-1">
                {active && def.type === 'textarea' && (
                  <button
                    onClick={() => setPromptEditorKey(def.key)}
                    className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label={`Expand ${def.label} editor`}
                  >
                    Expand ↗
                  </button>
                )}
                <button
                  onClick={() => onToggleOverride(def.key)}
                  className={`text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-primary text-contrast' : 'bg-base text-muted'}`}
                >
                  {active ? 'Override' : 'Inherited'}
                </button>
              </div>
            </div>
            {active ? (
              def.type === 'select' ? (
                <select
                  value={draft[def.key] || ''}
                  onChange={(e) => onDraftChange(def.key, e.target.value)}
                  className="w-full px-2 py-1 rounded text-xs border outline-none"
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    borderColor: 'var(--color-primary)',
                  }}
                >
                  {def.options!.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : def.type === 'textarea' ? (
                <>
                  <textarea
                    value={draft[def.key] || ''}
                    onChange={(e) => onDraftChange(def.key, e.target.value)}
                    rows={3}
                    placeholder="Enter system prompt..."
                    className="w-full px-2 py-1 rounded text-xs border outline-none resize-y"
                    style={{
                      backgroundColor: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      borderColor: 'var(--color-primary)',
                    }}
                  />
                  {promptEditorKey === def.key && (
                    <SystemPromptEditorModal
                      value={draft[def.key] || ''}
                      onChange={(v) => onDraftChange(def.key, v)}
                      onClose={() => setPromptEditorKey(null)}
                    />
                  )}
                </>
              ) : (
                <input
                  type="number"
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={draft[def.key] || ''}
                  onChange={(e) => onDraftChange(def.key, e.target.value)}
                  className="w-full px-2 py-1 rounded text-xs border outline-none"
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    borderColor: 'var(--color-primary)',
                  }}
                />
              )
            ) : (
              <div className="text-[11px] px-2 py-1 rounded" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg)' }}>
                {inherited || '(default)'} <span className="opacity-60">from {source}</span>
              </div>
            )}
          </div>
        )
      })}

      {/* MCP Servers section */}
      {mcpServers.length > 0 && (
        <div className="flex flex-col gap-1 pt-1 border-t" style={{ borderColor: 'var(--color-bg)' }}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
              MCP Servers
            </label>
            <button
              onClick={onToggleMcpOverride}
              className={`text-[10px] px-1.5 py-0.5 rounded ${isMcpOverridden ? 'bg-primary text-contrast' : 'bg-base text-muted'}`}
            >
              {isMcpOverridden ? 'Override' : 'Inherited'}
            </button>
          </div>
          {isMcpOverridden ? (
            <div
              className="flex flex-col gap-0.5 rounded px-2 py-1 max-h-[120px] overflow-y-auto"
              style={{ backgroundColor: 'var(--color-bg)' }}
              role="group"
              aria-label="MCP server toggles"
            >
              {mcpServers.map((server) => {
                const serverActive = !mcpDisabledDraft.includes(server.name)
                return (
                  <button
                    key={server.name}
                    onClick={() => onToggleMcpServer(server.name)}
                    className="flex items-center gap-2 py-0.5 text-xs text-left hover:opacity-80 transition-opacity"
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
          ) : (
            <div className="text-[11px] px-2 py-1 rounded" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg)' }}>
              {mcpDisabledInherited.length > 0
                ? `${mcpServers.length - mcpDisabledInherited.length}/${mcpServers.length} enabled`
                : `All ${mcpServers.length} enabled`
              } <span className="opacity-60">from {inheritedSources?.['ai_mcpDisabled'] || 'Global'}</span>
            </div>
          )}
        </div>
      )}

      {/* CWD Restriction toggle */}
      <div className="flex flex-col gap-1 pt-1 border-t" style={{ borderColor: 'var(--color-bg)' }}>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
            CWD Write Restriction
          </label>
          <button
            onClick={() => onToggleOverride('hooks_cwdRestriction')}
            className={`text-[10px] px-1.5 py-0.5 rounded ${draft['hooks_cwdRestriction'] !== undefined ? 'bg-primary text-contrast' : 'bg-base text-muted'}`}
          >
            {draft['hooks_cwdRestriction'] !== undefined ? 'Override' : 'Inherited'}
          </button>
        </div>
        {draft['hooks_cwdRestriction'] !== undefined ? (
          <button
            onClick={() => onDraftChange('hooks_cwdRestriction', draft['hooks_cwdRestriction'] === 'true' ? 'false' : 'true')}
            className="flex items-center gap-2 px-2 py-1 rounded text-xs"
            style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
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
        ) : (
          <div className="text-[11px] px-2 py-1 rounded" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg)' }}>
            {(inheritedValues['hooks_cwdRestriction'] ?? 'true') === 'true' ? 'Enabled' : 'Disabled'} <span className="opacity-60">from {inheritedSources?.['hooks_cwdRestriction'] || 'Global'}</span>
          </div>
        )}
      </div>

      {/* CWD Whitelist section */}
      {onToggleCwdWhitelistOverride && (
        <div className="flex flex-col gap-1 pt-1 border-t" style={{ borderColor: 'var(--color-bg)' }}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
              CWD Whitelist
            </label>
            <button
              onClick={onToggleCwdWhitelistOverride}
              className={`text-[10px] px-1.5 py-0.5 rounded ${isCwdWhitelistOverridden ? 'bg-primary text-contrast' : 'bg-base text-muted'}`}
            >
              {isCwdWhitelistOverridden ? 'Override' : 'Inherited'}
            </button>
          </div>
          {isCwdWhitelistOverridden ? (
            <CwdWhitelistEditor
              entries={cwdWhitelistDraft ?? []}
              onChange={onCwdWhitelistChange!}
            />
          ) : (
            <div className="text-[11px] px-2 py-1 rounded" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg)' }}>
              {(cwdWhitelistInherited ?? []).length > 0
                ? `${(cwdWhitelistInherited ?? []).length} entries`
                : 'No entries'
              } <span className="opacity-60">from {inheritedSources?.['hooks_cwdWhitelist'] || 'Global'}</span>
            </div>
          )}
        </div>
      )}
    </>
  )
}
