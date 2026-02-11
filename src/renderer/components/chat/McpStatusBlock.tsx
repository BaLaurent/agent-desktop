import { useState } from 'react'
import type { McpConnectionStatus } from '../../../shared/types'

interface McpStatusBlockProps {
  servers: McpConnectionStatus[]
}

const dotClass: Record<string, string> = {
  connected: 'bg-success',
  connecting: 'bg-warning',
  error: 'bg-error',
}

export function McpStatusBlock({ servers }: McpStatusBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const hasErrors = servers.some((s) => s.status === 'error')
  const allConnected = servers.every((s) => s.status === 'connected')

  const summary = allConnected
    ? `${servers.length} MCP server${servers.length > 1 ? 's' : ''} connected`
    : hasErrors
      ? `MCP connection issues`
      : `Connecting to MCP servers...`

  return (
    <div
      className={`my-2 rounded-md text-xs font-mono overflow-hidden ${hasErrors ? 'status-block-error' : 'status-block-success'}`}
    >
      <button
        onClick={() => setExpanded((s) => !s)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
        aria-expanded={expanded}
        aria-label="Toggle MCP server status"
      >
        <span className={`font-semibold ${hasErrors ? 'text-error' : 'text-success'}`}>
          {expanded ? '\u25BC' : '\u25B6'} {summary}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 flex flex-col gap-1">
          {servers.map((server) => (
            <div key={server.name} className="flex items-center gap-2">
              <span
                className={`flex-shrink-0 w-[6px] h-[6px] rounded-full ${dotClass[server.status] || 'bg-error'}`}
              />
              <span className="text-body">{server.name}</span>
              <span className="text-muted">
                {server.status}
              </span>
              {server.error && (
                <span className="text-error truncate" title={server.error}>
                  {server.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
