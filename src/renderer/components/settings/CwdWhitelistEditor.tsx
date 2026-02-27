import type { CwdWhitelistEntry } from '../../../shared/types'

interface CwdWhitelistEditorProps {
  entries: CwdWhitelistEntry[]
  onChange: (entries: CwdWhitelistEntry[]) => void
  disabled?: boolean
}

export function CwdWhitelistEditor({ entries, onChange, disabled }: CwdWhitelistEditorProps) {
  const handleAdd = async () => {
    const path = await window.agent.system.selectFolder()
    if (path) {
      onChange([...entries, { path, access: 'readwrite' }])
    }
  }

  const handleRemove = (index: number) => {
    onChange(entries.filter((_, i) => i !== index))
  }

  const handleAccessChange = (index: number, access: 'read' | 'readwrite') => {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, access } : entry)))
  }

  return (
    <div className="flex flex-col gap-1">
      {entries.map((entry, index) => (
        <div
          key={entry.path}
          className="flex items-center gap-2 px-2 py-1 rounded text-xs"
          style={{ backgroundColor: 'var(--color-bg)' }}
        >
          <span
            className="flex-1 min-w-0 truncate font-mono"
            style={{ color: disabled ? 'var(--color-text-muted)' : 'var(--color-text)' }}
            title={entry.path}
          >
            {entry.path}
          </span>
          <select
            value={entry.access}
            onChange={(e) => handleAccessChange(index, e.target.value as 'read' | 'readwrite')}
            disabled={disabled}
            className="px-1.5 py-0.5 rounded text-[11px] border border-[var(--color-text-muted)]/20 outline-none"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: disabled ? 'var(--color-text-muted)' : 'var(--color-text)',
              opacity: disabled ? 0.5 : 1,
            }}
            aria-label={`Access level for ${entry.path}`}
          >
            <option value="readwrite">readwrite</option>
            <option value="read">read</option>
          </select>
          <button
            onClick={() => handleRemove(index)}
            disabled={disabled}
            className="px-1 py-0.5 rounded text-xs hover:opacity-70 transition-opacity"
            style={{
              color: 'var(--color-text-muted)',
              opacity: disabled ? 0.3 : 1,
              cursor: disabled ? 'default' : 'pointer',
            }}
            aria-label={`Remove ${entry.path}`}
          >
            &times;
          </button>
        </div>
      ))}
      <button
        onClick={handleAdd}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:opacity-70 transition-opacity"
        style={{
          color: disabled ? 'var(--color-text-muted)' : 'var(--color-primary)',
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'default' : 'pointer',
        }}
        aria-label="Add directory to whitelist"
      >
        + Add Directory
      </button>
    </div>
  )
}
