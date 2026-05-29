import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpTransportConfig } from './streaming'
import { expandStdioCommand } from '../utils/paths'

export interface McpToolSpec {
  name: string
  description?: string
  inputSchema: unknown
}

export interface McpClientHandle {
  name: string
  tools: McpToolSpec[]
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  close(): Promise<void>
}

export class McpConnectError extends Error {
  readonly serverName: string
  constructor(serverName: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause)
    super(`MCP server '${serverName}' failed to connect: ${causeMessage}`, { cause })
    this.name = 'McpConnectError'
    this.serverName = serverName
  }
}

function buildTransport(config: McpTransportConfig) {
  if ('command' in config) {
    const { command, args } = expandStdioCommand(config.command, config.args)
    return new StdioClientTransport({
      command,
      args,
      env: config.env ? ({ ...process.env, ...config.env } as Record<string, string>) : undefined,
    })
  }
  const url = new URL(config.url)
  if (config.type === 'sse') {
    return new SSEClientTransport(url, { requestInit: { headers: config.headers } })
  }
  return new StreamableHTTPClientTransport(url, { requestInit: { headers: config.headers } })
}

export async function createMcpClient(
  name: string,
  config: McpTransportConfig
): Promise<McpClientHandle> {
  const client = new Client({ name: 'agent-desktop', version: '0.1.0' }, { capabilities: {} })
  let toolList: Awaited<ReturnType<typeof client.listTools>>
  try {
    const transport = buildTransport(config)
    await client.connect(transport)
    toolList = await client.listTools()
  } catch (err) {
    throw new McpConnectError(name, err)
  }
  const specs: McpToolSpec[] = toolList.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))
  return {
    name,
    tools: specs,
    async callTool(toolName, args, signal) {
      const result = await client.callTool({ name: toolName, arguments: args }, undefined, { signal })
      return result
    },
    async close() {
      try {
        await client.close()
      } catch {
        // best-effort teardown; transports can throw on double-close
      }
    },
  }
}
