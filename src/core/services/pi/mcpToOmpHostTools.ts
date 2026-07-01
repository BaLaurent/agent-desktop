// Converts MCP tool specs into omp RPC host-tools (OmpHostTool[]).
//
// Replaces the former mcpToPiTools.ts: instead of producing pi ToolDefinitions
// (5-arg execute for the in-process SDK), it produces OmpHostTool objects whose
// 2-arg execute(params, ctx) is invoked by OmpRpcClient when omp emits a
// host_tool_call frame. The MCP call/result mapping is otherwise identical.

import type { McpClientHandle } from '../mcpClient'
import { mcpToolName } from '../../utils/mcpNames'
import type { OmpHostTool, OmpToolResult } from './ompRpcClient'

interface McpContentBlock {
  type: string
  text?: string
  data?: string
  mimeType?: string
  [k: string]: unknown
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function mapBlock(block: McpContentBlock): { type: string; text?: string; data?: string; mimeType?: string } {
  if (block.type === 'text' && typeof block.text === 'string') {
    return { type: 'text', text: block.text }
  }
  if (block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string') {
    return { type: 'image', data: block.data, mimeType: block.mimeType }
  }
  return { type: 'text', text: JSON.stringify(block) }
}

function mcpResultToOmp(result: unknown): OmpToolResult {
  const blocks = isRecord(result) && Array.isArray(result.content) ? (result.content as McpContentBlock[]) : []
  const content = blocks.map(mapBlock)
  const out: OmpToolResult = { content: content.length > 0 ? content : [{ type: 'text', text: '' }] }
  return out
}

/** Convert one connected MCP server's tools into omp host-tools. */
export function mcpServerToOmpHostTools(handle: McpClientHandle): OmpHostTool[] {
  return handle.tools.map((spec) => {
    const parameters = isRecord(spec.inputSchema) ? (spec.inputSchema as Record<string, unknown>) : { type: 'object' }
    const tool: OmpHostTool = {
      name: mcpToolName(handle.name, spec.name),
      label: `${handle.name}: ${spec.name}`,
      description: spec.description ?? '',
      parameters,
      async execute(params, ctx) {
        try {
          const raw = await handle.callTool(spec.name, params, ctx.signal)
          return mcpResultToOmp(raw)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return { content: [{ type: 'text', text: `MCP tool error: ${message}` }] }
        }
      },
    }
    return tool
  })
}
