import { describe, it, expect } from 'vitest'
import { parseMcpDisabledList, parseMcpJson } from './mcpUtils'

describe('parseMcpDisabledList', () => {
  it('returns empty array for undefined', () => {
    expect(parseMcpDisabledList(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseMcpDisabledList('')).toEqual([])
  })

  it('parses valid JSON array of strings', () => {
    expect(parseMcpDisabledList('["server-a","server-b"]')).toEqual(['server-a', 'server-b'])
  })

  it('returns empty array for empty JSON array', () => {
    expect(parseMcpDisabledList('[]')).toEqual([])
  })

  it('returns empty array for non-array JSON', () => {
    expect(parseMcpDisabledList('"just a string"')).toEqual([])
    expect(parseMcpDisabledList('42')).toEqual([])
    expect(parseMcpDisabledList('{"key":"val"}')).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseMcpDisabledList('not json')).toEqual([])
    expect(parseMcpDisabledList('[')).toEqual([])
  })
})

describe('parseMcpJson', () => {
  it('parses wrapped format (mcpServers)', () => {
    const json = JSON.stringify({
      mcpServers: {
        searxng: {
          command: 'mcp-searxng',
          env: { SEARXNG_URL: 'http://localhost:8080' },
        },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'searxng',
      type: 'stdio',
      command: 'mcp-searxng',
      env: { SEARXNG_URL: 'http://localhost:8080' },
    })
  })

  it('parses wrapped format with args', () => {
    const json = JSON.stringify({
      mcpServers: {
        myserver: {
          command: 'npx',
          args: ['-y', '@scope/package'],
        },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'myserver',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@scope/package'],
    })
  })

  it('parses naked format', () => {
    const json = JSON.stringify({
      myserver: {
        command: 'my-mcp',
        env: { API_KEY: 'secret' },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'myserver',
      type: 'stdio',
      command: 'my-mcp',
      env: { API_KEY: 'secret' },
    })
  })

  it('parses ultra-naked format (no name)', () => {
    const json = JSON.stringify({
      command: 'mcp-searxng',
      env: { SEARXNG_URL: 'http://localhost:8080' },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: '',
      type: 'stdio',
      command: 'mcp-searxng',
      env: { SEARXNG_URL: 'http://localhost:8080' },
    })
  })

  it('parses HTTP server config', () => {
    const json = JSON.stringify({
      mcpServers: {
        remote: {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer tok' },
        },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'remote',
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('parses SSE server config', () => {
    const json = JSON.stringify({
      mcpServers: {
        sse: {
          type: 'sse',
          url: 'https://example.com/sse',
        },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'sse',
      type: 'sse',
      url: 'https://example.com/sse',
    })
  })

  it('defaults url without type to http', () => {
    const json = JSON.stringify({
      myserver: { url: 'https://example.com/mcp' },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'myserver',
      type: 'http',
      url: 'https://example.com/mcp',
    })
  })

  it('takes first server when multiple present', () => {
    const json = JSON.stringify({
      mcpServers: {
        first: { command: 'cmd-a' },
        second: { command: 'cmd-b' },
      },
    })
    const result = parseMcpJson(json)
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.name).toBe('first')
      expect(result.command).toBe('cmd-a')
    }
  })

  it('returns error for invalid JSON', () => {
    expect(parseMcpJson('not json')).toBe('Invalid JSON')
  })

  it('returns error for array', () => {
    expect(parseMcpJson('[]')).toBe('Expected a JSON object')
  })

  it('returns error for empty mcpServers', () => {
    expect(parseMcpJson('{"mcpServers":{}}')).toBe('No server found in mcpServers')
  })

  it('returns error for config with neither command nor url', () => {
    const json = JSON.stringify({ mcpServers: { s: { foo: 'bar' } } })
    expect(parseMcpJson(json)).toBe('Config must have "command" (stdio) or "url" (http/sse)')
  })

  it('returns error for empty object', () => {
    expect(parseMcpJson('{}')).toBe('Empty JSON object')
  })
})
