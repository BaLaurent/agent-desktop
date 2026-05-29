import { describe, it, expect, vi } from 'vitest'

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => '/home/testuser' }
})

import { expandTilde, expandStdioCommand } from './paths'

// regression-only: simple string replacement tests — minimal coverage value
describe('expandTilde', () => {
  it('expands bare ~ to home directory', () => {
    expect(expandTilde('~')).toBe('/home/testuser')
  })

  it('expands ~/path to home + path', () => {
    expect(expandTilde('~/Documents/project')).toBe('/home/testuser/Documents/project')
  })

  it('expands ~/single-level', () => {
    expect(expandTilde('~/foo')).toBe('/home/testuser/foo')
  })

  it('returns non-tilde paths unchanged', () => {
    expect(expandTilde('/usr/local/bin')).toBe('/usr/local/bin')
    expect(expandTilde('relative/path')).toBe('relative/path')
    expect(expandTilde('')).toBe('')
  })

  it('does not expand tilde in the middle of a path', () => {
    expect(expandTilde('/some/~user/path')).toBe('/some/~user/path')
  })

  it('does not expand ~username (only bare ~)', () => {
    expect(expandTilde('~other/path')).toBe('~other/path')
  })
})

describe('expandStdioCommand', () => {
  it('expands a leading ~ in the command', () => {
    expect(expandStdioCommand('~/bin/my-mcp', [])).toEqual({
      command: '/home/testuser/bin/my-mcp',
      args: [],
    })
  })

  it('expands a leading ~ in each arg', () => {
    expect(expandStdioCommand('node', ['~/scripts/server.js', '--config', '~/cfg.json'])).toEqual({
      command: 'node',
      args: ['/home/testuser/scripts/server.js', '--config', '/home/testuser/cfg.json'],
    })
  })

  it('leaves non-tilde command and args untouched', () => {
    expect(expandStdioCommand('/usr/bin/node', ['index.js', '--port', '3000'])).toEqual({
      command: '/usr/bin/node',
      args: ['index.js', '--port', '3000'],
    })
  })
})
