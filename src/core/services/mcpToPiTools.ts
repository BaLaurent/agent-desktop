import { Type, type TSchema } from '@sinclair/typebox'
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent'
import type { ImageContent, TextContent } from '@mariozechner/pi-ai'
import type { McpClientHandle } from './mcpClient'
import { mcpToolName } from '../utils/mcpNames'

interface McpContentBlock {
  type: string
  text?: string
  data?: string
  mimeType?: string
  [k: string]: unknown
}

interface McpCallResult {
  content: McpContentBlock[]
  isError?: boolean
}

function mapBlock(block: McpContentBlock): TextContent | ImageContent {
  if (block.type === 'text' && typeof block.text === 'string') {
    return { type: 'text', text: block.text }
  }
  if (block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string') {
    return { type: 'image', data: block.data, mimeType: block.mimeType }
  }
  return { type: 'text', text: JSON.stringify(block) }
}

function mcpResultToPi(result: McpCallResult): AgentToolResult<unknown> {
  const content = (result.content ?? []).map(mapBlock)
  const out: AgentToolResult<unknown> = { content: content.length > 0 ? content : [{ type: 'text', text: '' }], details: undefined }
  if (result.isError) (out as AgentToolResult<unknown> & { isError?: boolean }).isError = true
  return out
}

function errorToPiResult(err: unknown): AgentToolResult<unknown> & { isError: boolean } {
  const message = err instanceof Error ? err.message : String(err)
  return {
    content: [{ type: 'text', text: `MCP tool error: ${message}` }],
    details: undefined,
    isError: true,
  } as AgentToolResult<unknown> & { isError: boolean }
}

export function mcpServerToPiTools(handle: McpClientHandle): ToolDefinition[] {
  return handle.tools.map((spec) => {
    const parameters = Type.Unsafe<Record<string, unknown>>(
      (spec.inputSchema as TSchema) ?? { type: 'object' }
    )
    const def: ToolDefinition = {
      name: mcpToolName(handle.name, spec.name),
      label: `${handle.name}: ${spec.name}`,
      description: spec.description ?? '',
      parameters,
      async execute(_toolCallId, params, signal) {
        try {
          const raw = (await handle.callTool(spec.name, params as Record<string, unknown>, signal)) as McpCallResult
          return mcpResultToPi(raw)
        } catch (err) {
          return errorToPiResult(err)
        }
      },
    }
    return def
  })
}
