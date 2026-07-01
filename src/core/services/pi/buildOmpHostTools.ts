// Assembles the host-owned tools omp may call back into over RPC:
//   - the scheduler tool (trusted internal; only when a scheduler bridge exists)
//   - one host-tool per MCP tool, spawned per-turn from aiSettings.mcpServers
//
// Replaces buildCustomTools.ts + setupMcp.ts. omp owns its native built-in tools
// (read/bash/edit/write) in the subprocess and gates them via its own approval
// channel, so there is NO per-tool canUseTool wrap here (that was only needed
// because the in-process SDK ran tools in-process). MCP clients are spawned
// per-turn and returned so the caller can tear them down in a finally block.

import { createMcpClient, McpConnectError, type McpClientHandle } from '../mcpClient'
import { mcpServerToOmpHostTools } from './mcpToOmpHostTools'
import { sendChunk } from '../streaming'
import type { McpTransportConfig } from '../streaming'
import type { OmpHostTool } from './ompRpcClient'

export interface BuildOmpHostToolsOptions {
  /** Built lazily by the caller so the scheduler tool is only added when live. */
  schedulerTool: OmpHostTool | null
  mcpServers: Record<string, McpTransportConfig>
  convExtra: Record<string, string | number>
}

export interface BuildOmpHostToolsResult {
  hostTools: OmpHostTool[]
  mcpHandles: McpClientHandle[]
}

export async function buildOmpHostTools(opts: BuildOmpHostToolsOptions): Promise<BuildOmpHostToolsResult> {
  const { schedulerTool, mcpServers, convExtra } = opts
  const hostTools: OmpHostTool[] = []
  if (schedulerTool) hostTools.push(schedulerTool)

  const mcpEntries = Object.entries(mcpServers).filter(([name]) => !name.includes('__'))
  if (mcpEntries.length === 0) {
    return { hostTools, mcpHandles: [] }
  }

  const mcpServerNames = mcpEntries.map(([name]) => name)
  sendChunk(
    'system_message',
    `Loading ${mcpServerNames.length} MCP server${mcpServerNames.length === 1 ? '' : 's'}: ${mcpServerNames.join(', ')}…`,
    { hookName: 'mcp', hookEvent: 'spawn_started', ...convExtra },
  )

  const spawnStart = Date.now()
  const spawnResults = await Promise.allSettled(
    mcpEntries.map(async ([name, config]) => ({ name, handle: await createMcpClient(name, config) })),
  )

  const mcpHandles: McpClientHandle[] = []
  let toolCount = 0
  let okCount = 0

  for (const r of spawnResults) {
    if (r.status === 'fulfilled') {
      mcpHandles.push(r.value.handle)
      const tools = mcpServerToOmpHostTools(r.value.handle)
      hostTools.push(...tools)
      toolCount += tools.length
      okCount++
    } else {
      const errMsg =
        r.reason instanceof McpConnectError
          ? r.reason.message
          : r.reason instanceof Error
            ? r.reason.message
            : String(r.reason)
      sendChunk('system_message', errMsg, { hookName: 'mcp', hookEvent: 'spawn_failed', ...convExtra })
    }
  }

  const elapsedSec = ((Date.now() - spawnStart) / 1000).toFixed(1)
  sendChunk(
    'system_message',
    `MCP ready: ${okCount}/${mcpServerNames.length} server${mcpServerNames.length === 1 ? '' : 's'}, ${toolCount} tool${toolCount === 1 ? '' : 's'} (${elapsedSec}s)`,
    { hookName: 'mcp', hookEvent: 'spawn_complete', ...convExtra },
  )

  return { hostTools, mcpHandles }
}
