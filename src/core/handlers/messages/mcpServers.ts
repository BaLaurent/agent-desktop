// MCP server map construction for `getAISettings`.
//
// CLAUDE.md > "AI, MCP & Streaming Gotchas":
//   - Scheduler MCP is removed during unattended execution to prevent
//     recursive task creation; the caller controls injection via the
//     `getSchedulerMcpConfig` callback (returns null when in unattended
//     mode).
//   - MCP disable is a *negative* list — new servers auto-active unless
//     explicitly disabled.
//   - Scheduler MCP is Claude SDK only; PI uses native MCP per-stream
//     (see streamingPI.ts) so we never inject it for the PI backend.

import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import type { AISettings } from '../../services/streaming'
import { safeJsonParse } from '../../utils/json'
import { expandStdioCommand } from '../../utils/paths'
import { createLogger } from '../../utils/logger'

const log = createLogger('mcpServers')

export type McpServerMap = AISettings['mcpServers']

interface McpRow {
  name: string
  type: string | null
  command: string
  args: string
  env: string
  url: string | null
  headers: string | null
}

/** Load enabled MCP servers from `mcp_servers` table into the SDK shape. */
export function loadMcpServersFromDb(db: SqlJsAdapter): McpServerMap {
  const rows = (db as any)
    .prepare('SELECT name, type, command, args, env, url, headers FROM mcp_servers WHERE enabled = 1')
    .all() as McpRow[]

  const servers: McpServerMap = {}
  for (const row of rows) {
    try {
      const transport = row.type || 'stdio'
      if (transport === 'http' || transport === 'sse') {
        if (!row.url) continue
        const headers = safeJsonParse<Record<string, string>>(row.headers || '{}', {})
        servers[row.name] = {
          type: transport,
          url: row.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        }
      } else {
        const env = safeJsonParse<Record<string, string>>(row.env, {})
        const { command, args } = expandStdioCommand(row.command, safeJsonParse<string[]>(row.args, []))
        servers[row.name] = {
          command,
          args,
          ...(Object.keys(env).length > 0 ? { env } : {}),
        }
      }
    } catch (err) {
      log.error('Invalid MCP config', err, { name: row.name })
    }
  }
  return servers
}

/**
 * Drop disabled servers from the map. `disabledJson` is the cascaded
 * `ai_mcpDisabled` value (negative list per CLAUDE.md gotcha).
 */
export function filterDisabledMcpServers(
  servers: McpServerMap,
  disabledJson: string | undefined,
): McpServerMap {
  if (!disabledJson) return servers
  const disabled = safeJsonParse<string[]>(disabledJson, [])
  if (!Array.isArray(disabled) || disabled.length === 0) return servers
  const disabledSet = new Set(disabled)
  const filtered: McpServerMap = {}
  for (const [name, config] of Object.entries(servers || {})) {
    if (!disabledSet.has(name)) filtered[name] = config
  }
  return filtered
}

/**
 * Inject the scheduler MCP server (Claude SDK only). Skipped when:
 *   - backend is not `claude-agent-sdk` (PI has its own MCP path)
 *   - `getSchedulerMcpConfig` is not provided
 *   - the callback returns `null` (e.g. unattended task execution)
 */
export function injectSchedulerMcp(
  servers: McpServerMap,
  sdkBackend: string,
  conversationId: number,
  getSchedulerMcpConfig: ((id: number) => Record<string, unknown> | null) | undefined,
): void {
  if (!servers) return
  if (sdkBackend !== 'claude-agent-sdk') return
  if (!getSchedulerMcpConfig) return
  const schedulerMcp = getSchedulerMcpConfig(conversationId)
  if (schedulerMcp) {
    servers['agent_scheduler'] = schedulerMcp as any
  }
}
