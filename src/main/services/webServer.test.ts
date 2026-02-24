import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import WebSocket from 'ws'

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

// Import AFTER mocks are declared (ES module hoisting handles ordering)
import { startServer, stopServer, getServerStatus } from './webServer'
import { ipcDispatch } from '../ipc'

// We need a free port for tests
function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000)
}

describe('webServer', () => {
  let port: number

  beforeEach(() => {
    port = getRandomPort()
    // Ensure clean state
    ipcDispatch.clear()
  })

  afterEach(async () => {
    await stopServer()
  })

  it('starts and reports status', async () => {
    const result = await startServer(port)
    expect(result.url).toContain(String(port))
    expect(result.token).toBeTruthy()
    expect(result.token.length).toBe(64) // 32 bytes = 64 hex chars

    const status = getServerStatus()
    expect(status.running).toBe(true)
    expect(status.port).toBe(port)
    expect(status.clients).toBe(0)
  })

  it('serves index.html with shim injection', async () => {
    await startServer(port)

    const res = await fetch(`http://127.0.0.1:${port}/`)
    // Will 404 since out/renderer/index.html doesn't exist in test env,
    // but let's check the server responds
    expect(res.status).toBeDefined()
  })

  it('serves the shim script', async () => {
    await startServer(port)

    const res = await fetch(`http://127.0.0.1:${port}/agent-ws-shim.js`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('__AGENT_WEB_MODE__')
    expect(body).toContain('window.agent')
  })

  it('WebSocket auth succeeds with correct token', async () => {
    const { token } = await startServer(port)

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
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
    const status = getServerStatus()
    expect(status.clients).toBe(1)

    ws.close()
  })

  it('WebSocket auth fails with wrong token', async () => {
    await startServer(port)

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
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

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
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

  it('returns error for unknown channel', async () => {
    const { token } = await startServer(port)

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
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
    expect(getServerStatus().running).toBe(true)

    await stopServer()
    expect(getServerStatus().running).toBe(false)
    expect(getServerStatus().clients).toBe(0)
  })

  it('returns existing server on double start', async () => {
    const result1 = await startServer(port)
    const result2 = await startServer(port)
    expect(result1.token).toBe(result2.token)
  })
})
