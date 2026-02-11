import { SETTING_DEFS, type McpServerName } from '../../../shared/constants'
import { Checkbox } from '../ui/Checkbox'

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
}: OverrideFormFieldsProps) {
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
              <button
                onClick={() => onToggleOverride(def.key)}
                className={`text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-primary text-contrast' : 'bg-base text-muted'}`}
              >
                {active ? 'Override' : 'Inherited'}
              </button>
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
    </>
  )
}
