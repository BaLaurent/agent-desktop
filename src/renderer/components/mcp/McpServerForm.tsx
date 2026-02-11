import { useState, useCallback } from 'react'
import type { McpServer, McpTransportType } from '../../../shared/types'
import { useMcpStore } from '../../stores/mcpStore'

interface McpServerFormProps {
  server?: McpServer | null
  onClose: () => void
}

interface EnvRow {
  key: string
  value: string
}

function parseArgs(argsJson: string): string[] {
  try {
    const arr = JSON.parse(argsJson)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function parseEnv(envJson: string): EnvRow[] {
  try {
    const obj = JSON.parse(envJson)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const entries = Object.entries(obj) as [string, string][]
      return entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : []
    }
  } catch {
    // fall through
  }
  return []
}

export function McpServerForm({ server, onClose }: McpServerFormProps) {
  const { addServer, updateServer } = useMcpStore()
  const isEdit = server != null

  const [name, setName] = useState(server?.name ?? '')
  const [serverType, setServerType] = useState<McpTransportType>(
    (server?.type as McpTransportType) || 'stdio'
  )
  const [command, setCommand] = useState(server?.command ?? '')
  const [argRows, setArgRows] = useState<string[]>(
    server ? parseArgs(server.args) : []
  )
  const [envRows, setEnvRows] = useState<EnvRow[]>(
    server ? parseEnv(server.env) : []
  )
  const [url, setUrl] = useState(server?.url ?? '')
  const [headerRows, setHeaderRows] = useState<EnvRow[]>(
    server ? parseEnv(server.headers) : []
  )
  const [saving, setSaving] = useState(false)

  const handleAddArg = useCallback(() => {
    setArgRows((prev) => [...prev, ''])
  }, [])

  const handleRemoveArg = useCallback((index: number) => {
    setArgRows((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleArgChange = useCallback((index: number, val: string) => {
    setArgRows((prev) => prev.map((a, i) => (i === index ? val : a)))
  }, [])

  const handleAddEnv = useCallback(() => {
    setEnvRows((prev) => [...prev, { key: '', value: '' }])
  }, [])

  const handleRemoveEnv = useCallback((index: number) => {
    setEnvRows((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleEnvChange = useCallback(
    (index: number, field: 'key' | 'value', val: string) => {
      setEnvRows((prev) =>
        prev.map((row, i) => (i === index ? { ...row, [field]: val } : row))
      )
    },
    []
  )

  const handleAddHeader = useCallback(() => {
    setHeaderRows((prev) => [...prev, { key: '', value: '' }])
  }, [])

  const handleRemoveHeader = useCallback((index: number) => {
    setHeaderRows((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleHeaderChange = useCallback(
    (index: number, field: 'key' | 'value', val: string) => {
      setHeaderRows((prev) =>
        prev.map((row, i) => (i === index ? { ...row, [field]: val } : row))
      )
    },
    []
  )

  const isValid = serverType === 'stdio'
    ? name.trim() && command.trim()
    : name.trim() && url.trim()

  const handleSave = useCallback(async () => {
    if (!isValid) return

    setSaving(true)
    try {
      if (serverType === 'stdio') {
        const args = argRows.flatMap((s) => s.trim().split(/\s+/)).filter(Boolean)

        const env: Record<string, string> = {}
        for (const row of envRows) {
          if (row.key.trim()) env[row.key.trim()] = row.value
        }

        if (isEdit && server) {
          await updateServer(server.id, {
            name: name.trim(), type: 'stdio', command: command.trim(), args, env,
          })
        } else {
          await addServer({
            name: name.trim(), type: 'stdio', command: command.trim(), args, env,
          })
        }
      } else {
        const headers: Record<string, string> = {}
        for (const row of headerRows) {
          if (row.key.trim()) headers[row.key.trim()] = row.value
        }

        if (isEdit && server) {
          await updateServer(server.id, {
            name: name.trim(), type: serverType, url: url.trim(), headers,
          })
        } else {
          await addServer({
            name: name.trim(), type: serverType, url: url.trim(), headers,
          })
        }
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }, [name, serverType, command, argRows, envRows, url, headerRows, isValid, isEdit, server, addServer, updateServer, onClose])

  const inputClass =
    'w-full bg-[var(--color-bg)] text-[var(--color-text)] border border-[var(--color-text-muted)]/30 rounded px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]'

  const typeOptions: { value: McpTransportType; label: string }[] = [
    { value: 'stdio', label: 'stdio' },
    { value: 'http', label: 'HTTP' },
    { value: 'sse', label: 'SSE' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-lg p-5 flex flex-col gap-4 shadow-xl max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
          {isEdit ? 'Edit Server' : 'Add Server'}
        </h2>

        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Name *
          </label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-server"
          />
        </div>

        {/* Transport Type */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Transport
          </label>
          <div className="flex gap-2">
            {typeOptions.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-1.5 text-sm cursor-pointer"
                style={{ color: 'var(--color-text)' }}
              >
                <input
                  type="radio"
                  name="transport"
                  value={opt.value}
                  checked={serverType === opt.value}
                  onChange={() => setServerType(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {serverType === 'stdio' ? (
          <>
            {/* Command */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Command *
              </label>
              <input
                className={inputClass}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
              />
            </div>

            {/* Arguments */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  Arguments
                </label>
                <button
                  onClick={handleAddArg}
                  className="text-xs px-2 py-0.5 rounded transition-opacity hover:opacity-80"
                  style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
                >
                  + Add
                </button>
              </div>
              {argRows.length === 0 && (
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  No arguments. Click "+ Add" to add one.
                </div>
              )}
              {argRows.map((arg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={arg}
                    onChange={(e) => handleArgChange(i, e.target.value)}
                    placeholder={i === 0 ? '-y' : '@scope/package-name'}
                  />
                  <button
                    onClick={() => handleRemoveArg(i)}
                    className="flex-shrink-0 w-7 h-7 rounded flex items-center justify-center text-xs transition-opacity hover:opacity-80"
                    style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-error)' }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            {/* Environment Variables */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  Environment Variables
                </label>
                <button
                  onClick={handleAddEnv}
                  className="text-xs px-2 py-0.5 rounded transition-opacity hover:opacity-80"
                  style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
                >
                  + Add
                </button>
              </div>
              {envRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={row.key}
                    onChange={(e) => handleEnvChange(i, 'key', e.target.value)}
                    placeholder="KEY"
                    style={{ flex: 1 }}
                  />
                  <input
                    className={inputClass}
                    value={row.value}
                    onChange={(e) => handleEnvChange(i, 'value', e.target.value)}
                    placeholder="value"
                    style={{ flex: 2 }}
                  />
                  <button
                    onClick={() => handleRemoveEnv(i)}
                    className="flex-shrink-0 w-7 h-7 rounded flex items-center justify-center text-xs transition-opacity hover:opacity-80"
                    style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-error)' }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* URL */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                URL *
              </label>
              <input
                className={inputClass}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://my-mcp-server.example.com/mcp"
              />
            </div>

            {/* Headers */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  Headers
                </label>
                <button
                  onClick={handleAddHeader}
                  className="text-xs px-2 py-0.5 rounded transition-opacity hover:opacity-80"
                  style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
                >
                  + Add
                </button>
              </div>
              {headerRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={row.key}
                    onChange={(e) => handleHeaderChange(i, 'key', e.target.value)}
                    placeholder="Authorization"
                    style={{ flex: 1 }}
                  />
                  <input
                    className={inputClass}
                    value={row.value}
                    onChange={(e) => handleHeaderChange(i, 'value', e.target.value)}
                    placeholder="Bearer token..."
                    style={{ flex: 2 }}
                  />
                  <button
                    onClick={() => handleRemoveHeader(i)}
                    className="flex-shrink-0 w-7 h-7 rounded flex items-center justify-center text-xs transition-opacity hover:opacity-80"
                    style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-error)' }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid || saving}
            className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40 bg-primary text-contrast"
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
