import { describe, it, expect, vi } from 'vitest'

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => '/home/testuser' }
})

import { expandTilde } from './paths'

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
