/**
 * Coverage for `mcpServerToOmpHostTools`: converting a connected MCP server's
 * tool specs into `OmpHostTool[]` — name-spacing, schema passthrough, and the
 * execute() adapter that calls into `McpClientHandle.callTool` and maps the
 * MCP content-block result (or a thrown error) into an `OmpToolResult`.
 */
import { describe, it, expect, vi } from 'vitest'
import { mcpServerToOmpHostTools } from './mcpToOmpHostTools'
import type { McpClientHandle } from '../mcpClient'
import type { OmpHostToolContext } from './ompRpcClient'

function makeContext(): OmpHostToolContext {
  return { toolCallId: 'c', signal: new AbortController().signal, sendUpdate() {} }
}

describe('mcpServerToOmpHostTools', () => {
  it('name-spaces the tool and passes through label/description/schema', () => {
    const handle: McpClientHandle = {
      name: 'srv',
      tools: [{ name: 'foo', description: 'd', inputSchema: { type: 'object', properties: { x: { type: 'number' } } } }],
      callTool: vi.fn(),
      close: vi.fn(),
    }

    const [tool] = mcpServerToOmpHostTools(handle)

    expect(tool.name).toBe('mcp__srv__foo')
    expect(tool.label).toBe('srv: foo')
    expect(tool.description).toBe('d')
    expect(tool.parameters).toBe(handle.tools[0].inputSchema)
  })

  it('defaults description to empty string and parameters to a bare object schema when missing/non-object', () => {
    const handle: McpClientHandle = {
      name: 'srv',
      tools: [{ name: 'bar', inputSchema: 'not-an-object' }],
      callTool: vi.fn(),
      close: vi.fn(),
    }

    const [tool] = mcpServerToOmpHostTools(handle)

    expect(tool.description).toBe('')
    expect(tool.parameters).toEqual({ type: 'object' })
  })

  it('execute() calls callTool with the tool name, params, and signal, mapping a text content result', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] })
    const handle: McpClientHandle = {
      name: 'srv',
      tools: [{ name: 'foo', description: 'd', inputSchema: { type: 'object' } }],
      callTool,
      close: vi.fn(),
    }
    const [tool] = mcpServerToOmpHostTools(handle)
    const ctx = makeContext()

    const result = await tool.execute({ x: 1 }, ctx)

    expect(callTool).toHaveBeenCalledWith('foo', { x: 1 }, ctx.signal)
    expect(result).toEqual({ content: [{ type: 'text', text: 'result' }] })
  })

  it('maps an image content block through with data + mimeType', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }],
    })
    const handle: McpClientHandle = {
      name: 'srv',
      tools: [{ name: 'shot', inputSchema: { type: 'object' } }],
      callTool,
      close: vi.fn(),
    }
    const [tool] = mcpServerToOmpHostTools(handle)

    const result = await tool.execute({}, makeContext())

    expect(result).toEqual({ content: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }] })
  })

  it('falls back to a JSON-stringified text block for an unrecognized content block shape', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'resource_link', uri: 'file:///x' }] })
    const handle: McpClientHandle = {
      name: 'srv',
      tools: [{ name: 'link', inputSchema: { type: 'object' } }],
      callTool,
      close: vi.fn(),
    }
    const [tool] = mcpServerToOmpHostTools(handle)

    const result = await tool.execute({}, makeContext())

    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ type: 'resource_link', uri: 'file:///x' }) }] })
  })

  it('falls back to a single empty text block when the MCP result has no content array', async () => {
    const callTool = vi.fn().mockResolvedValue({})
    const handle: McpClientHandle = {
      name: 'srv',
      tools: [{ name: 'empty', inputSchema: { type: 'object' } }],
      callTool,
      close: vi.fn(),
    }
    const [tool] = mcpServerToOmpHostTools(handle)

    const result = await tool.execute({}, makeContext())

    expect(result).toEqual({ content: [{ type: 'text', text: '' }] })
  })

  it('a rejected callTool resolves (not throws) to an error-message text content result', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('boom'))
    const handle: McpClientHandle = {
      name: 'srv',
      tools: [{ name: 'flaky', inputSchema: { type: 'object' } }],
      callTool,
      close: vi.fn(),
    }
    const [tool] = mcpServerToOmpHostTools(handle)

    const result = await tool.execute({}, makeContext())

    expect(result).toEqual({ content: [{ type: 'text', text: 'MCP tool error: boom' }] })
  })

  it('a rejected non-Error value is stringified into the error message', async () => {
    const callTool = vi.fn().mockRejectedValue('plain-string-failure')
    const handle: McpClientHandle = {
      name: 'srv',
      tools: [{ name: 'flaky2', inputSchema: { type: 'object' } }],
      callTool,
      close: vi.fn(),
    }
    const [tool] = mcpServerToOmpHostTools(handle)

    const result = await tool.execute({}, makeContext())

    expect(result).toEqual({ content: [{ type: 'text', text: 'MCP tool error: plain-string-failure' }] })
  })

  it('converts every tool spec on the handle, preserving order', () => {
    const handle: McpClientHandle = {
      name: 'multi',
      tools: [
        { name: 'a', inputSchema: { type: 'object' } },
        { name: 'b', inputSchema: { type: 'object' } },
      ],
      callTool: vi.fn(),
      close: vi.fn(),
    }

    const tools = mcpServerToOmpHostTools(handle)

    expect(tools.map((t) => t.name)).toEqual(['mcp__multi__a', 'mcp__multi__b'])
  })
})
