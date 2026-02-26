import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs.promises before importing hookRunner
const mockReadFile = vi.fn()
vi.mock('fs', () => ({
  promises: { readFile: (...args: unknown[]) => mockReadFile(...args) },
}))

// Mock electron app
vi.mock('electron', () => ({
  app: { getPath: () => '/home/testuser' },
}))

// Mock child_process.exec
const mockExec = vi.fn()
vi.mock('child_process', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}))

import { runUserPromptSubmitHooks } from './hookRunner'

describe('runUserPromptSubmitHooks', () => {
  beforeEach(() => {
    mockReadFile.mockReset()
    mockExec.mockReset()
  })

  it('returns empty array when settings.json has no hooks', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}))
    const result = await runUserPromptSubmitHooks('test prompt', '/cwd', 'bypassPermissions')
    expect(result).toEqual([])
  })

  it('returns empty array when settings.json is missing', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    const result = await runUserPromptSubmitHooks('test prompt', '/cwd', 'bypassPermissions')
    expect(result).toEqual([])
  })

  it('returns empty array when no UserPromptSubmit hooks configured', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
    }))
    const result = await runUserPromptSubmitHooks('test prompt', '/cwd', 'bypassPermissions')
    expect(result).toEqual([])
  })

  it('executes hook command and extracts systemMessage', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'bash /path/to/hook.sh', timeout: 10 }],
        }],
      },
    }))

    const hookOutput = JSON.stringify({ systemMessage: 'Reformulated prompt here' })
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string) => void) => {
      cb(null, hookOutput)
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const result = await runUserPromptSubmitHooks('test prompt', '/cwd', 'bypassPermissions')
    expect(result).toEqual([{
      content: 'Reformulated prompt here',
      hookEvent: 'UserPromptSubmit',
    }])
  })

  it('passes prompt as JSON on stdin', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'bash hook.sh' }],
        }],
      },
    }))

    const stdinWrite = vi.fn()
    const stdinEnd = vi.fn()
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string) => void) => {
      cb(null, '')
      return { stdin: { write: stdinWrite, end: stdinEnd } }
    })

    await runUserPromptSubmitHooks('hello world', '/my/cwd', 'default')

    expect(stdinWrite).toHaveBeenCalledOnce()
    const stdinJson = JSON.parse(stdinWrite.mock.calls[0][0] as string) as Record<string, unknown>
    expect(stdinJson.prompt).toBe('hello world')
    expect(stdinJson.cwd).toBe('/my/cwd')
    expect(stdinJson.hook_event_name).toBe('UserPromptSubmit')
    expect(stdinJson.permission_mode).toBe('default')
    expect(stdinEnd).toHaveBeenCalledOnce()
  })

  it('ignores hooks with non-JSON output', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'echo hi' }],
        }],
      },
    }))

    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string) => void) => {
      cb(null, 'not json')
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const result = await runUserPromptSubmitHooks('test', '/cwd', 'bypass')
    expect(result).toEqual([])
  })

  it('ignores hooks with JSON output lacking systemMessage', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'echo hi' }],
        }],
      },
    }))

    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string) => void) => {
      cb(null, JSON.stringify({ hookSpecificOutput: { additionalContext: 'stuff' } }))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const result = await runUserPromptSubmitHooks('test', '/cwd', 'bypass')
    expect(result).toEqual([])
  })

  it('ignores hooks that error', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'false' }],
        }],
      },
    }))

    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error) => void) => {
      cb(new Error('exit code 1'))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const result = await runUserPromptSubmitHooks('test', '/cwd', 'bypass')
    expect(result).toEqual([])
  })

  it('ignores hooks with empty stdout', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'true' }],
        }],
      },
    }))

    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string) => void) => {
      cb(null, '')
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const result = await runUserPromptSubmitHooks('test', '/cwd', 'bypass')
    expect(result).toEqual([])
  })

  it('uses timeout from hook config (seconds → milliseconds)', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'slow-hook', timeout: 30 }],
        }],
      },
    }))

    mockExec.mockImplementation((_cmd: string, opts: { timeout: number }, cb: (err: null, stdout: string) => void) => {
      expect(opts.timeout).toBe(30_000)
      cb(null, '')
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    await runUserPromptSubmitHooks('test', '/cwd', 'bypass')
  })

  it('defaults to 60s timeout when not specified', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'command', command: 'hook' }],
        }],
      },
    }))

    mockExec.mockImplementation((_cmd: string, opts: { timeout: number }, cb: (err: null, stdout: string) => void) => {
      expect(opts.timeout).toBe(60_000)
      cb(null, '')
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    await runUserPromptSubmitHooks('test', '/cwd', 'bypass')
  })

  it('skips non-command hook types', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [{
          hooks: [{ type: 'other', command: 'should-not-run' }],
        }],
      },
    }))

    await runUserPromptSubmitHooks('test', '/cwd', 'bypass')
    expect(mockExec).not.toHaveBeenCalled()
  })

  it('processes multiple hooks in sequence', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'hook1' }] },
          { hooks: [{ type: 'command', command: 'hook2' }] },
        ],
      },
    }))

    let callCount = 0
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string) => void) => {
      callCount++
      cb(null, JSON.stringify({ systemMessage: `msg${callCount}` }))
      return { stdin: { write: vi.fn(), end: vi.fn() } }
    })

    const result = await runUserPromptSubmitHooks('test', '/cwd', 'bypass')
    expect(result).toEqual([
      { content: 'msg1', hookEvent: 'UserPromptSubmit' },
      { content: 'msg2', hookEvent: 'UserPromptSubmit' },
    ])
  })
})
