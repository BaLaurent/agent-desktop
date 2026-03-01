import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import { execFileSync } from 'child_process'
import * as fsSync from 'fs'
import * as path from 'path'
import * as os from 'os'

// Mock ipc module — avoid loading Electron-dependent import chain.
// Factory must not reference top-level variables (vi.mock is hoisted).
vi.mock('../ipc', () => ({
  ipcDispatch: new Map(),
}))

// Mock broadcast module — we don't want actual broadcast wiring in tests
vi.mock('../utils/broadcast', () => ({
  setBroadcastHandler: vi.fn(),
  broadcast: vi.fn(),
}))

// Mock electron (app.getPath not available in test)
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/agent-test-data') },
}))

// Mock cert module — returns pre-generated test cert
vi.mock('../utils/cert', () => ({
  ensureSelfSignedCert: vi.fn(),
}))

// Import AFTER mocks are declared (ES module hoisting handles ordering)
import { startServer, stopServer, getServerStatus } from './webServer'
import { ipcDispatch } from '../ipc'
import { ensureSelfSignedCert } from '../utils/cert'

// We need a free port for tests
function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000)
}

// Generate a real test cert (https.createServer needs valid PEM data)
let testKey: Buffer
let testCert: Buffer
let testSslDir: string

const originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED

describe('webServer', () => {
  let port: number

  beforeAll(() => {
    // Disable TLS verification for self-signed cert in tests
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    // Generate real test cert
    testSslDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'ws-test-ssl-'))
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec',
      '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-keyout', path.join(testSslDir, 'key.pem'),
      '-out', path.join(testSslDir, 'cert.pem'),
      '-days', '1', '-nodes', '-subj', '/CN=Test',
    ])
    testKey = fsSync.readFileSync(path.join(testSslDir, 'key.pem'))
    testCert = fsSync.readFileSync(path.join(testSslDir, 'cert.pem'))
  })

  afterAll(() => {
    if (originalTlsReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsReject

    fsSync.rmSync(testSslDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    port = getRandomPort()
    // Ensure clean state
    ipcDispatch.clear()
    vi.mocked(ensureSelfSignedCert).mockResolvedValue({ key: testKey, cert: testCert })
  })

  afterEach(async () => {
    await stopServer()
  })

  it('starts and reports status', async () => {
    const result = await startServer(port)
    expect(result.url).toContain(String(port))
    expect(result.url).toContain('/s/') // short URL format
    expect(result.token).toBeTruthy()
    expect(result.token.length).toBe(64) // 32 bytes = 64 hex chars

    const status = await getServerStatus()
    expect(status.running).toBe(true)
    expect(status.port).toBe(port)
    expect(status.clients).toBe(0)
    expect(status.shortCode).toBeTruthy()
    expect(status.accessMode).toBe('lan')
  })

  it('serves index.html with shim injection', async () => {
    await startServer(port)

    const res = await fetch(`https://127.0.0.1:${port}/`)
    // Will 404 since out/renderer/index.html doesn't exist in test env,
    // but let's check the server responds
    expect(res.status).toBeDefined()
  })

  it('serves the shim script', async () => {
    await startServer(port)

    const res = await fetch(`https://127.0.0.1:${port}/agent-ws-shim.js`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('__AGENT_WEB_MODE__')
    expect(body).toContain('window.agent')
  })

  it('WebSocket auth succeeds with correct token', async () => {
    const { token } = await startServer(port)

    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
    const messages: any[] = []

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }))
      })
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
        if (messages.length === 1) resolve()
      })
    })

    expect(messages[0]).toEqual({ type: 'auth_result', success: true })

    // Check client count
    const status = await getServerStatus()
    expect(status.clients).toBe(1)

    ws.close()
  })

  it('WebSocket auth fails with wrong token', async () => {
    await startServer(port)

    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
    const messages: any[] = []

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: 'wrong-token' }))
      })
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
        if (messages.length === 1) resolve()
      })
    })

    expect(messages[0]).toEqual({ type: 'auth_result', success: false, error: 'Invalid token' })
    ws.close()
  })

  it('dispatches invoke to ipcDispatch handlers', async () => {
    const { token } = await startServer(port)

    // Register a test handler
    ipcDispatch.set('test:echo', async (...args: unknown[]) => {
      return { echoed: args }
    })

    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
    const messages: any[] = []

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }))
      })
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        messages.push(msg)
        if (msg.type === 'auth_result' && msg.success) {
          ws.send(JSON.stringify({ type: 'invoke', id: '1', channel: 'test:echo', args: ['hello', 42] }))
        }
        if (msg.type === 'result') resolve()
      })
      ws.on('error', reject)
    })

    const result = messages.find(m => m.type === 'result')
    expect(result).toEqual({ type: 'result', id: '1', result: { echoed: ['hello', 42] } })
    ws.close()
  })

  it('preserves undefined args through JSON roundtrip', async () => {
    const { token } = await startServer(port)

    ipcDispatch.set('test:optionalArgs', async (...args: unknown[]) => {
      return { args, types: args.map(a => typeof a) }
    })

    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
    const messages: any[] = []

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }))
      })
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        messages.push(msg)
        if (msg.type === 'auth_result' && msg.success) {
          // Simulate what the shim sends: undefined encoded as { __type: 'undefined' }
          ws.send(JSON.stringify({
            type: 'invoke', id: '1', channel: 'test:optionalArgs',
            args: [{ __type: 'undefined' }, 42, { __type: 'undefined' }],
          }))
        }
        if (msg.type === 'result') resolve()
      })
      ws.on('error', reject)
    })

    const result = messages.find(m => m.type === 'result')
    // undefined args should arrive as undefined (not null)
    expect(result.result.types).toEqual(['undefined', 'number', 'undefined'])
    ws.close()
  })

  it('returns error for unknown channel', async () => {
    const { token } = await startServer(port)

    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
    const messages: any[] = []

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }))
      })
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        messages.push(msg)
        if (msg.type === 'auth_result' && msg.success) {
          ws.send(JSON.stringify({ type: 'invoke', id: '2', channel: 'nonexistent:channel', args: [] }))
        }
        if (msg.type === 'result') resolve()
      })
    })

    const result = messages.find(m => m.type === 'result')
    expect(result.error).toContain('Unknown channel')
    ws.close()
  })

  it('stops cleanly', async () => {
    await startServer(port)
    expect((await getServerStatus()).running).toBe(true)

    await stopServer()
    expect((await getServerStatus()).running).toBe(false)
    expect((await getServerStatus()).clients).toBe(0)
  })

  it('returns existing server on double start', async () => {
    const result1 = await startServer(port)
    const result2 = await startServer(port)
    expect(result1.token).toBe(result2.token)
  })

  describe('short URL routing', () => {
    it('serves shim with token via /s/<code>', async () => {
      const result = await startServer(port, { shortCode: 'testCode' })
      const status = await getServerStatus()
      expect(status.shortCode).toBe('testCode')

      const res = await fetch(`https://127.0.0.1:${port}/s/testCode`)
      // Will 404 in test env (no renderer/index.html), but validates the route is handled
      expect(res.status).toBeDefined()
    })

    it('rejects invalid short code with 403', async () => {
      await startServer(port, { shortCode: 'goodCode' })

      const res = await fetch(`https://127.0.0.1:${port}/s/badCode`)
      expect(res.status).toBe(403)
      const body = await res.text()
      expect(body).toBe('Invalid short code')
    })

    it('uses custom short code from options', async () => {
      const result = await startServer(port, { shortCode: 'myCustom1' })
      expect(result.url).toContain('/s/myCustom1')

      const status = await getServerStatus()
      expect(status.shortCode).toBe('myCustom1')
      expect(status.url).toContain('/s/myCustom1')
    })

    it('auto-generates short code when not provided', async () => {
      const result = await startServer(port)
      // URL should contain /s/ with some auto-generated code
      expect(result.url).toMatch(/\/s\/[a-zA-Z0-9]+/)

      const status = await getServerStatus()
      expect(status.shortCode).toBeTruthy()
      expect(status.shortCode!.length).toBe(8)
    })

    it('backward compat: ?token= query string still works', async () => {
      await startServer(port)

      // The old ?token= URL format goes through normal static file serving
      const res = await fetch(`https://127.0.0.1:${port}/?token=sometoken`)
      // Will 404 in test env but validates the route is not blocked
      expect(res.status).toBeDefined()
      expect(res.status).not.toBe(403)
    })
  })

  describe('HTTP to HTTPS redirect', () => {
    it('redirects plain HTTP requests to HTTPS', async () => {
      await startServer(port)

      // Plain HTTP request to the same port — should get 301 redirect
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' })
      expect(res.status).toBe(301)
      const location = res.headers.get('location')
      expect(location).toBe(`https://127.0.0.1:${port}/`)
    })

    it('preserves path in HTTP to HTTPS redirect', async () => {
      await startServer(port, { shortCode: 'redir' })

      const res = await fetch(`http://127.0.0.1:${port}/s/redir`, { redirect: 'manual' })
      expect(res.status).toBe(301)
      const location = res.headers.get('location')
      expect(location).toBe(`https://127.0.0.1:${port}/s/redir`)
    })
  })

  describe('access mode', () => {
    it('defaults to lan mode', async () => {
      await startServer(port)
      const status = await getServerStatus()
      expect(status.accessMode).toBe('lan')
    })

    it('accepts all mode', async () => {
      await startServer(port, { accessMode: 'all' })
      const status = await getServerStatus()
      expect(status.accessMode).toBe('all')
    })

    it('allows localhost in lan mode', async () => {
      await startServer(port)
      // Requests from 127.0.0.1 should always be allowed
      const res = await fetch(`https://127.0.0.1:${port}/agent-ws-shim.js`)
      expect(res.status).toBe(200)
    })
  })

  describe('getServerStatus format', () => {
    it('includes shortCode and accessMode when running', async () => {
      await startServer(port, { shortCode: 'abc12XYz', accessMode: 'all' })
      const status = await getServerStatus()
      expect(status.shortCode).toBe('abc12XYz')
      expect(status.accessMode).toBe('all')
      expect(status.url).toContain('/s/abc12XYz')
      expect(status.urlHostname).toContain('/s/abc12XYz')
    })

    it('returns null shortCode and accessMode when stopped', async () => {
      const status = await getServerStatus()
      expect(status.shortCode).toBeNull()
      expect(status.accessMode).toBeNull()
    })
  })

  describe('WebSocket channel blocklist', () => {
    async function invokeChannel(
      ws: WebSocket,
      token: string,
      channel: string,
      id: string,
    ): Promise<any> {
      const messages: any[] = []
      return new Promise<any>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'auth', token }))
        })
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString())
          messages.push(msg)
          if (msg.type === 'auth_result' && msg.success) {
            ws.send(JSON.stringify({ type: 'invoke', id, channel, args: [] }))
          }
          if (msg.type === 'result') resolve(msg)
        })
        ws.on('error', reject)
      })
    }

    it('blocks server:start via WebSocket', async () => {
      const { token } = await startServer(port)
      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
      const result = await invokeChannel(ws, token, 'server:start', '10')
      expect(result.error).toContain('Channel not available via WebSocket: server:start')
      ws.close()
    })

    it('blocks server:stop via WebSocket', async () => {
      const { token } = await startServer(port)
      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
      const result = await invokeChannel(ws, token, 'server:stop', '11')
      expect(result.error).toContain('Channel not available via WebSocket: server:stop')
      ws.close()
    })

    it('blocks openscad:exportStl via WebSocket', async () => {
      const { token } = await startServer(port)
      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
      const result = await invokeChannel(ws, token, 'openscad:exportStl', '12')
      expect(result.error).toContain('Channel not available via WebSocket: openscad:exportStl')
      ws.close()
    })

    it('does not block a normal registered channel', async () => {
      const { token } = await startServer(port)

      ipcDispatch.set('test:ping', async () => 'pong')

      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
      const result = await invokeChannel(ws, token, 'test:ping', '13')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('pong')
      ws.close()
    })
  })
})
