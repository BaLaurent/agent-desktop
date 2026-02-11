import { useEffect, useState, useCallback } from 'react'
import type { McpServer } from '../../../shared/types'
import { useMcpStore } from '../../stores/mcpStore'
import { McpServerForm } from './McpServerForm'

function truncateText(text: string, max = 30): string {
  if (text.length <= max) return text
  return text.slice(0, max - 3) + '...'
}

const statusColors: Record<McpServer['status'], string> = {
  configured: 'bg-primary',
  disabled: 'bg-muted',
  error: 'bg-error',
}

const badgeClass: Record<string, string> = {
  http: 'bg-tool',
  sse: 'bg-accent',
}

export function McpServerList() {
  const { servers, isLoading, loadServers, toggleServer, removeServer, testConnection, testResults, clearTestResult } = useMcpStore()
  const [showForm, setShowForm] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServer | null>(null)

  useEffect(() => {
    loadServers()
  }, [loadServers])

  const handleEdit = useCallback((server: McpServer) => {
    setEditingServer(server)
    setShowForm(true)
  }, [])

  const handleAdd = useCallback(() => {
    setEditingServer(null)
    setShowForm(true)
  }, [])

  const handleCloseForm = useCallback(() => {
    setShowForm(false)
    setEditingServer(null)
  }, [])

  const handleRemove = useCallback(
    async (server: McpServer) => {
      if (window.confirm(`Remove server "${server.name}"?`)) {
        await removeServer(server.id)
      }
    },
    [removeServer]
  )

  const handleTest = useCallback(
    (server: McpServer) => {
      testConnection(server.id)
    },
    [testConnection]
  )

  if (isLoading) {
    return (
      <div className="px-3 py-4 text-sm text-muted">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-body">
          MCP Servers
        </h2>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-80 bg-primary text-contrast"
        >
          Add Server
        </button>
      </div>

      {servers.length === 0 ? (
        <div className="text-sm py-4 text-center text-muted">
          No servers configured
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {servers.map((server) => {
            const transport = server.type || 'stdio'
            const isRemote = transport === 'http' || transport === 'sse'
            const subtitle = isRemote
              ? truncateText(server.url || '', 40)
              : truncateText(server.command)
            const testState = testResults[server.id]

            return (
              <div key={server.id} className="flex flex-col">
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-deep">
                  {/* Status dot */}
                  <span
                    className={`flex-shrink-0 w-2 h-2 rounded-full ${statusColors[server.status]}`}
                    title={server.status}
                  />

                  {/* Server info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate text-body">
                        {server.name}
                      </span>
                      {isRemote && (
                        <span
                          className={`text-[10px] font-bold px-1 py-0.5 rounded text-contrast ${badgeClass[transport] || 'bg-surface'}`}
                        >
                          {transport.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="text-xs truncate text-muted">
                      {subtitle}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleTest(server)}
                      disabled={testState?.loading}
                      className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-40 bg-tool text-contrast"
                      title="Test connection"
                      aria-label={`Test ${server.name} connection`}
                    >
                      {testState?.loading ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      onClick={() => toggleServer(server.id)}
                      className={`px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 ${
                        server.enabled ? 'bg-success text-contrast' : 'bg-surface text-muted'
                      }`}
                      title={server.enabled ? 'Disable' : 'Enable'}
                    >
                      {server.enabled ? 'On' : 'Off'}
                    </button>
                    <button
                      onClick={() => handleEdit(server)}
                      className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 bg-surface text-body"
                      title="Edit server"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleRemove(server)}
                      className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 bg-surface text-error"
                      title="Remove server"
                    >
                      Del
                    </button>
                  </div>
                </div>

                {/* Test result panel */}
                {testState?.result && (
                  <div
                    className={`mx-2 mb-1 rounded-b-lg px-3 py-2 text-xs border-l-[3px] ${
                      testState.result.success
                        ? 'result-bg-success border-l-success'
                        : 'result-bg-error border-l-error'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`font-semibold ${testState.result.success ? 'text-success' : 'text-error'}`}
                      >
                        {testState.result.success ? 'Connection OK' : 'Connection Failed'}
                      </span>
                      <button
                        onClick={() => clearTestResult(server.id)}
                        className="text-[10px] px-1.5 py-0.5 rounded transition-opacity hover:opacity-80 bg-surface text-muted"
                        aria-label="Dismiss test result"
                      >
                        Dismiss
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-all font-mono leading-relaxed max-h-48 overflow-y-auto text-body">
                      {testState.result.output}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && <McpServerForm server={editingServer} onClose={handleCloseForm} />}
    </div>
  )
}
