import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homedir } from 'os'

const mockConnect = vi.fn()
const mockListTools = vi.fn()
const mockCallTool = vi.fn()
const mockClose = vi.fn()

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function () {
    this.connect = mockConnect
    this.listTools = mockListTools
    this.callTool = mockCallTool
    this.close = mockClose
  }),
}))

const mockStdioCtor = vi.fn()
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(function (opts) {
    mockStdioCtor(opts)
    this._tag = 'stdio'
    this.opts = opts
  }),
}))

const mockHttpCtor = vi.fn()
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function (url, opts) {
    mockHttpCtor(url, opts)
    this._tag = 'http'
    this.url = url
    this.opts = opts
  }),
}))

const mockSseCtor = vi.fn()
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn().mockImplementation(function (url, opts) {
    mockSseCtor(url, opts)
    this._tag = 'sse'
    this.url = url
    this.opts = opts
  }),
}))

import { createMcpClient, McpConnectError } from './mcpClient'

beforeEach(() => {
  vi.clearAllMocks()
  mockConnect.mockResolvedValue(undefined)
  mockListTools.mockResolvedValue({
    tools: [
      { name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    ],
  })
  mockClose.mockResolvedValue(undefined)
})

describe('createMcpClient — stdio', () => {
  it('spawns stdio transport with command/args/env', async () => {
    const handle = await createMcpClient('fs', {
      command: '/usr/bin/node',
      args: ['server.js'],
      env: { FOO: 'bar' },
    })

    const passedOpts = mockStdioCtor.mock.calls[0][0] as { command: string; args: string[]; env: Record<string, string> }
    expect(passedOpts.command).toBe('/usr/bin/node')
    expect(passedOpts.args).toEqual(['server.js'])
    expect(passedOpts.env.FOO).toBe('bar')
    expect(passedOpts.env.PATH).toBe(process.env.PATH)
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(handle.name).toBe('fs')
    expect(handle.tools).toHaveLength(1)
    expect(handle.tools[0].name).toBe('echo')
  })

  it('expands a leading ~ in command and args before spawning (shell: false)', async () => {
    await createMcpClient('tilde', {
      command: '~/bin/my-mcp',
      args: ['~/config.json', '--port', '3000'],
    })
    const passedOpts = mockStdioCtor.mock.calls[0][0] as { command: string; args: string[] }
    expect(passedOpts.command).toBe(`${homedir()}/bin/my-mcp`)
    expect(passedOpts.args).toEqual([`${homedir()}/config.json`, '--port', '3000'])
  })

  it('omits env when not provided', async () => {
    await createMcpClient('fs', { command: 'node', args: [] })
    expect(mockStdioCtor).toHaveBeenCalledWith({
      command: 'node',
      args: [],
      env: undefined,
    })
  })

  it('merges process.env with config.env when env is provided', async () => {
    const originalPath = process.env.PATH
    await createMcpClient('fs', { command: 'x', args: [], env: { API_KEY: 'test' } })
    const passedEnv = (mockStdioCtor.mock.calls[0][0] as { env: Record<string, string> }).env
    expect(passedEnv.API_KEY).toBe('test')
    expect(passedEnv.PATH).toBe(originalPath) // inherited from process.env
  })
})

describe('createMcpClient — http', () => {
  it('constructs StreamableHTTPClientTransport with url and headers', async () => {
    await createMcpClient('remote', {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer abc' },
    })
    expect(mockHttpCtor).toHaveBeenCalledTimes(1)
    const [urlArg, optsArg] = mockHttpCtor.mock.calls[0]
    expect(urlArg).toBeInstanceOf(URL)
    expect(urlArg.toString()).toBe('https://example.com/mcp')
    expect(optsArg).toMatchObject({ requestInit: { headers: { Authorization: 'Bearer abc' } } })
  })
})

describe('createMcpClient — sse', () => {
  it('constructs SSEClientTransport with url and headers', async () => {
    await createMcpClient('stream', {
      type: 'sse',
      url: 'https://example.com/sse',
      headers: { 'X-Key': '123' },
    })
    expect(mockSseCtor).toHaveBeenCalledTimes(1)
    const [urlArg, optsArg] = mockSseCtor.mock.calls[0]
    expect(urlArg.toString()).toBe('https://example.com/sse')
    expect(optsArg).toMatchObject({ requestInit: { headers: { 'X-Key': '123' } } })
  })
})

describe('createMcpClient — error handling', () => {
  it('wraps connect failure in McpConnectError', async () => {
    mockConnect.mockRejectedValueOnce(new Error('spawn failed'))
    await expect(createMcpClient('broken', { command: 'nope', args: [] }))
      .rejects.toMatchObject({ name: 'McpConnectError', serverName: 'broken' })
  })

  it('wraps listTools failure in McpConnectError', async () => {
    mockListTools.mockRejectedValueOnce(new Error('enumeration failed'))
    await expect(createMcpClient('enum-broken', { command: 'x', args: [] }))
      .rejects.toMatchObject({ name: 'McpConnectError', serverName: 'enum-broken' })
  })

  it('wraps malformed URL failure in McpConnectError', async () => {
    await expect(
      createMcpClient('bad-url', { type: 'http', url: 'not a url' })
    ).rejects.toMatchObject({ name: 'McpConnectError', serverName: 'bad-url' })
  })
})

describe('McpClientHandle — runtime', () => {
  it('callTool forwards name, args, and signal', async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    const handle = await createMcpClient('srv', { command: 'x', args: [] })
    const ac = new AbortController()
    await handle.callTool('echo', { text: 'hi' }, ac.signal)
    expect(mockCallTool).toHaveBeenCalledWith(
      { name: 'echo', arguments: { text: 'hi' } },
      undefined,
      { signal: ac.signal }
    )
  })

  it('close swallows transport errors (best-effort)', async () => {
    mockClose.mockRejectedValueOnce(new Error('already closed'))
    const handle = await createMcpClient('srv', { command: 'x', args: [] })
    await expect(handle.close()).resolves.toBeUndefined()
  })
})
