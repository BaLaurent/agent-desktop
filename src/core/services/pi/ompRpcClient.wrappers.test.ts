/**
 * Coverage for the OmpRpcClient command wrappers added for omp-native exposure:
 * `getAvailableCommands` and `getSessionStats`. The child process is faked at
 * the `node:child_process.spawn` boundary — we capture stdin writes and inject
 * `ready` + `response` frames on stdout, so the wire framing is exercised
 * without a real omp binary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

interface FakeProc extends EventEmitter {
  stdin: { write: (s: string) => void; end: () => void }
  stdout: PassThrough
  stderr: PassThrough
  kill: (sig?: string) => void
}

const { spawnMock, writes, emitStdout } = vi.hoisted(() => {
  const writes: string[] = []
  let stdout: PassThrough | null = null
  const spawnMock = vi.fn((_cmd: string, _args: string[], _opts: { cwd?: string; env?: Record<string, string | undefined> }) => {
    const proc = new EventEmitter() as FakeProc
    stdout = new PassThrough()
    proc.stdout = stdout
    proc.stderr = new PassThrough()
    proc.stdin = { write: (s: string) => { writes.push(s) }, end: () => {} }
    proc.kill = () => {}
    // Emit ready on next tick so start()'s readline listener is attached first.
    queueMicrotask(() => stdout?.write('{"type":"ready"}\n'))
    return proc
  })
  const emitStdout = (line: string) => { stdout?.write(line + '\n') }
  return { spawnMock, writes, emitStdout }
})

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { OmpRpcClient } from './ompRpcClient'

beforeEach(() => {
  writes.length = 0
  spawnMock.mockClear()
})

describe('OmpRpcClient command wrappers', () => {
  it('getAvailableCommands sends {type:"get_available_commands"} and resolves the response data', async () => {
    const client = new OmpRpcClient({ ompPath: '/fake/omp' })
    await client.start()

    const p = client.getAvailableCommands()
    const sent = JSON.parse(writes[writes.length - 1]) as Record<string, unknown>
    expect(sent.type).toBe('get_available_commands')
    expect(typeof sent.id).toBe('string')

    emitStdout(JSON.stringify({
      type: 'response', id: sent.id, command: 'get_available_commands', success: true,
      data: { commands: [{ name: 'model', description: 'Show model', source: 'builtin' }] },
    }))

    const resp = await p
    expect(resp.success).toBe(true)
    const data = resp.data as { commands: Array<{ name: string; source: string }> }
    expect(data.commands[0]).toEqual({ name: 'model', description: 'Show model', source: 'builtin' })
    client.stop()
  })

  it('getSessionStats sends {type:"get_session_stats"} and resolves token/cost data', async () => {
    const client = new OmpRpcClient({ ompPath: '/fake/omp' })
    await client.start()

    const p = client.getSessionStats()
    const sent = JSON.parse(writes[writes.length - 1]) as Record<string, unknown>
    expect(sent.type).toBe('get_session_stats')

    emitStdout(JSON.stringify({
      type: 'response', id: sent.id, command: 'get_session_stats', success: true,
      data: { totalMessages: 3, tokens: { total: 1234 }, cost: 0.02 },
    }))

    const resp = await p
    const data = resp.data as { totalMessages: number; tokens: { total: number }; cost: number }
    expect(data.totalMessages).toBe(3)
    expect(data.tokens.total).toBe(1234)
    client.stop()
  })

  it('waitForTurnEnd resolves on an agent_end frame', async () => {
    const client = new OmpRpcClient({ ompPath: '/fake/omp' })
    await client.start()
    const p = client.waitForTurnEnd(5000)
    emitStdout(JSON.stringify({ type: 'agent_end', messages: [] }))
    const frame = await p
    expect(frame.type).toBe('agent_end')
    client.stop()
  })

  it('waitForTurnEnd also resolves on a prompt_result frame (async local-only completion)', async () => {
    const client = new OmpRpcClient({ ompPath: '/fake/omp' })
    await client.start()
    const p = client.waitForTurnEnd(5000)
    emitStdout(JSON.stringify({ type: 'prompt_result', id: 'req_1', agentInvoked: false }))
    const frame = await p
    expect(frame.type).toBe('prompt_result')
    client.stop()
  })
})

describe('OmpRpcClient spawn cwd resolution', () => {
  it('falls back to a valid cwd when the requested cwd does not exist (avoids the misleading ENOENT)', async () => {
    const client = new OmpRpcClient({ ompPath: '/fake/omp', cwd: '/tmp/does-not-exist-xyz-abc-99999' })
    await client.start()
    const opts = spawnMock.mock.calls[0][2]
    // Must NOT pass the non-existent dir through (that throws ENOENT naming the binary).
    expect(opts.cwd).not.toBe('/tmp/does-not-exist-xyz-abc-99999')
    expect(typeof opts.cwd === 'string' || opts.cwd === undefined).toBe(true)
    client.stop()
  })

  it('passes a valid existing cwd through unchanged', async () => {
    const client = new OmpRpcClient({ ompPath: '/fake/omp', cwd: '/tmp' })
    await client.start()
    const opts = spawnMock.mock.calls[0][2]
    expect(opts.cwd).toBe('/tmp')
    client.stop()
  })

  it('leaves cwd undefined when none is provided (spawn uses process cwd)', async () => {
    const client = new OmpRpcClient({ ompPath: '/fake/omp' })
    await client.start()
    const opts = spawnMock.mock.calls[0][2]
    expect(opts.cwd).toBeUndefined()
    client.stop()
  })
})
