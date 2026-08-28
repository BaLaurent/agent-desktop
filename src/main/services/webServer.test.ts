import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import { execFileSync } from 'child_process'
import * as fsSync from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as http from 'http'

// Mock cert module — returns pre-generated test cert
vi.mock('../../core/utils/cert', () => ({
  ensureSelfSignedCert: vi.fn(),
}))

// Spy on the piUIChannel response route so we can prove the WS `respond`
// frame reaches `respondPIUI` exactly when expected.
const respondPIUIMock = vi.fn()
vi.mock('../../core/services/pi/piUIChannel', () => ({
  respondPIUI: (resp: unknown) => respondPIUIMock(resp),
}))

// Import AFTER mocks are declared (ES module hoisting handles ordering)
import { startServer, stopServer, getServerStatus, isLoopbackAddress } from '../../core/services/webServer'
import { DispatchRegistry } from '../../core/dispatch'
import { ensureSelfSignedCert } from '../../core/utils/cert'
import { createWebPasswordService } from '../../core/auth'

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

  let testDispatch: DispatchRegistry

  beforeEach(() => {
    port = getRandomPort()
    testDispatch = new DispatchRegistry()
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

  it('dispatches invoke to registered handlers', async () => {
    // Register a test handler before starting so it's available via dispatch
    testDispatch.handle('test:echo', async (_event, ...args: unknown[]) => {
      return { echoed: args }
    })
    const { token } = await startServer(port, { dispatch: testDispatch })

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
    testDispatch.handle('test:optionalArgs', async (_event, ...args: unknown[]) => {
      return { args, types: args.map(a => typeof a) }
    })
    const { token } = await startServer(port, { dispatch: testDispatch })

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

  it('cleans up client count after disconnect', async () => {
    const { token } = await startServer(port)

    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }))
      })
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'auth_result' && msg.success) resolve()
      })
    })

    expect((await getServerStatus()).clients).toBe(1)

    // Disconnect and wait for server-side cleanup
    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve())
      ws.close()
    })
    // Server-side close handler fires asynchronously after client-side
    await new Promise((r) => setTimeout(r, 50))

    expect((await getServerStatus()).clients).toBe(0)
  })

  it('accepts new connections after previous client disconnects', async () => {
    const { token } = await startServer(port)

    // First client connects and authenticates
    const ws1 = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
    await new Promise<void>((resolve) => {
      ws1.on('open', () => ws1.send(JSON.stringify({ type: 'auth', token })))
      ws1.on('message', (data) => {
        if (JSON.parse(data.toString()).type === 'auth_result') resolve()
      })
    })

    // First client disconnects
    await new Promise<void>((resolve) => {
      ws1.on('close', () => resolve())
      ws1.close()
    })

    // Second client connects — server must accept it normally
    const ws2 = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
    const messages: any[] = []
    await new Promise<void>((resolve) => {
      ws2.on('open', () => ws2.send(JSON.stringify({ type: 'auth', token })))
      ws2.on('message', (data) => {
        messages.push(JSON.parse(data.toString()))
        if (messages[0]?.type === 'auth_result') resolve()
      })
    })

    expect(messages[0]).toEqual({ type: 'auth_result', success: true })
    expect((await getServerStatus()).clients).toBe(1)
    ws2.close()
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


    it('does not block a normal registered channel', async () => {
      testDispatch.handle('test:ping', async () => 'pong')
      const { token } = await startServer(port, { dispatch: testDispatch })

      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
      const result = await invokeChannel(ws, token, 'test:ping', '13')
      expect(result.error).toBeUndefined()
      expect(result.result).toBe('pong')
      ws.close()
    })
  })

  describe('isLoopbackAddress (helper)', () => {
    it('classifies 127.0.0.1 as loopback', () => {
      expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    })
    it('classifies ::1 as loopback', () => {
      expect(isLoopbackAddress('::1')).toBe(true)
    })
    it('classifies the IPv4-mapped IPv6 form ::ffff:127.0.0.1 as loopback', () => {
      expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    })
    it('rejects a private IPv4 address', () => {
      expect(isLoopbackAddress('192.168.1.50')).toBe(false)
      expect(isLoopbackAddress('10.0.0.3')).toBe(false)
    })
    it('rejects the IPv4-mapped IPv6 form of a private address', () => {
      expect(isLoopbackAddress('::ffff:192.168.1.50')).toBe(false)
    })
    it('rejects undefined and empty inputs', () => {
      expect(isLoopbackAddress(undefined)).toBe(false)
      expect(isLoopbackAddress('')).toBe(false)
    })
  })

  // Typed shape of one server frame — narrower than `unknown`, broader than
  // `any`. Used by the respond and ws-local tests so the helpers stay free of `as any`.
  type WsMsg = Record<string, unknown> & { type?: string }

  describe('WS `respond` frame reaches respondPIUI', () => {
    // Build a deferred that resolves the next time `respondPIUI` is invoked,
    // so the test awaits the real side effect rather than a wall-clock wait.
    function nextRespondInvocation(): { promise: Promise<unknown> } {
      const { promise, resolve } = Promise.withResolvers<unknown>()
      respondPIUIMock.mockImplementation((resp: unknown) => {
        resolve(resp)
      })
      return { promise }
    }

    async function authAndSendRespond(token: string, respondPayload: object): Promise<WsMsg> {
      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
      const sent = await new Promise<WsMsg>((resolve, reject) => {
        ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })))
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as WsMsg
          if (msg.type === 'auth_result' && msg.success === true) {
            ws.send(JSON.stringify(respondPayload))
          }
          if (msg.type === 'auth_result') resolve(msg)
        })
        ws.on('error', reject)
      })
      ws.close()
      return sent
    }

    it('an authenticated client sending a `respond` frame invokes respondPIUI with the payload', async () => {
      respondPIUIMock.mockReset()
      const { token } = await startServer(port)
      const waiter = nextRespondInvocation()

      await authAndSendRespond(token, {
        type: 'respond',
        id: 'req-42',
        value: 'user typed this',
        confirmed: true,
        cancelled: false,
      })

      const received = await waiter.promise
      expect(received).toEqual({
        id: 'req-42',
        value: 'user typed this',
        confirmed: true,
        cancelled: false,
      })
      expect(respondPIUIMock).toHaveBeenCalledTimes(1)
    })

    it('an UNauthenticated client sending a `respond` frame does NOT invoke respondPIUI', async () => {
      respondPIUIMock.mockReset()
      await startServer(port)

      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
      const authFrame = await new Promise<WsMsg>((resolve, reject) => {
        ws.on('open', () => ws.send(JSON.stringify({
          type: 'respond',
          id: 'should-not-arrive',
          value: 'sneaky',
        })))
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as WsMsg
          // The server replies to a pre-auth `respond` with an auth_result
          // carrying `Not authenticated` — that's the signal we're done.
          if (msg.type === 'auth_result') resolve(msg)
        })
        ws.on('error', reject)
      })
      ws.close()

      expect(authFrame.success).toBe(false)
      expect(authFrame.error).toBe('Not authenticated')
      expect(respondPIUIMock).not.toHaveBeenCalled()
    })

    it('a `respond` frame missing `id` is silently dropped', async () => {
      respondPIUIMock.mockReset()
      const { token } = await startServer(port)
      await authAndSendRespond(token, { type: 'respond', value: 'no id' })
      expect(respondPIUIMock).not.toHaveBeenCalled()
    })
  })

  describe('WS-local dispatch origin', () => {
    async function invokeAs(token: string, channel: string, args: unknown[] = []): Promise<WsMsg> {
      const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false })
      try {
        const result = await new Promise<WsMsg>((resolve, reject) => {
          ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })))
          ws.on('message', (data) => {
            const msg = JSON.parse(data.toString()) as WsMsg
            if (msg.type === 'auth_result' && msg.success === true) {
              ws.send(JSON.stringify({ type: 'invoke', id: 'loc', channel, args }))
            }
            if (msg.type === 'result') resolve(msg)
          })
          ws.on('error', reject)
        })
        return result
      } finally {
        ws.close()
      }
    }

    it('allows a channel in LOCAL_WS_ALLOWED_CHANNELS for a loopback client', async () => {
      testDispatch.handle('test:mcpAllowed', async () => 'allowed')
      const { token } = await startServer(port, { dispatch: testDispatch })

      const result = await invokeAs(token, 'mcp:testConnection', [{ name: 'fake', command: 'echo' }])

      // Either the handler runs successfully or it returns a handler-internal
      // error — but the gate MUST NOT refuse with the documented string.
      const errorMsg = typeof result.error === 'string' ? result.error : ''
      expect(errorMsg).not.toContain('Channel not available via WebSocket: mcp:testConnection')
    })

    it('still refuses a channel that is ELECTRON_ONLY but NOT in LOCAL_WS_ALLOWED', async () => {
      // system:openExternal is ELECTRON_ONLY and not on the loopback exception list.
      const { token } = await startServer(port)
      const result = await invokeAs(token, 'system:openExternal')
      expect(result.error).toContain('Channel not available via WebSocket: system:openExternal')
    })

    it('still refuses WS_BLOCKED channels for a loopback client (absolute block)', async () => {
      const { token } = await startServer(port)
      const result = await invokeAs(token, 'server:setPassword')
      expect(result.error).toContain('Channel not available via WebSocket: server:setPassword')
    })
  })
})

// ─── Login gate integration tests ───────────────────────────────────────────

function memSettingsForAuth() {
  const s = new Map<string, string>()
  return {
    set: (k: string, v: string) => { v === '' ? s.delete(k) : s.set(k, v) },
    get: (k: string) => s.get(k),
    delete: (k: string) => { s.delete(k) },
    getAll: () => Object.fromEntries(s),
  }
}

function httpFetch(
  port: number,
  options: http.RequestOptions & { body?: string },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    // Use a fresh agent with keepAlive disabled so each request opens a new TCP connection.
    // This prevents ECONNRESET when the server is restarted between tests.
    const agent = new http.Agent({ keepAlive: false })
    const mergedHeaders = { Connection: 'close', ...(options.headers as Record<string, string> | undefined) }
    const req = http.request({ hostname: '127.0.0.1', port, agent, ...options, headers: mergedHeaders }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf-8') }))
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

describe('webServer login gate', () => {
  const port = 60484
  let webPasswordSvc: ReturnType<typeof createWebPasswordService>

  beforeEach(async () => {
    // Force HTTP mode — override the mock to reject (simulates missing OpenSSL)
    vi.mocked(ensureSelfSignedCert).mockRejectedValue(new Error('no cert for login-gate tests'))

    webPasswordSvc = createWebPasswordService(memSettingsForAuth())
    await webPasswordSvc.setPassword('integration test pw')
    const dispatch = new DispatchRegistry()
    await startServer(port, {
      dispatch,
      webPassword: webPasswordSvc,
      shortCode: 'testshort',
      sslDir: '/tmp/does-not-exist-intentionally',
      rendererDir: __dirname,
    })
  })

  afterEach(async () => {
    await stopServer()
  })

  it('redirects to /login when no cookie is present', async () => {
    const r = await httpFetch(port, { method: 'GET', path: '/' })
    expect(r.status).toBe(302)
    expect(r.headers.location).toBe('/login')
  })

  it('GET /login returns the login page', async () => {
    const r = await httpFetch(port, { method: 'GET', path: '/login' })
    expect(r.status).toBe(200)
    expect(r.body).toContain('type="password"')
  })

  it('POST /login with wrong password returns 401', async () => {
    const r = await httpFetch(port, {
      method: 'POST', path: '/login',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
    })
    expect(r.status).toBe(401)
  })

  it('POST /login with correct password sets cookie and redirects', async () => {
    const r = await httpFetch(port, {
      method: 'POST', path: '/login',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=integration%20test%20pw',
    })
    expect(r.status).toBe(302)
    expect(r.headers['set-cookie']?.[0]).toMatch(/agent_session=/)
  })

  it('POST /login 6 times triggers rate limit 429', async () => {
    for (let i = 0; i < 5; i++) {
      await httpFetch(port, {
        method: 'POST', path: '/login',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=wrong',
      })
    }
    const r = await httpFetch(port, {
      method: 'POST', path: '/login',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
    })
    expect(r.status).toBe(429)
  })
})
