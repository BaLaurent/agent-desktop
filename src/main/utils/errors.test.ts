import { describe, it, expect } from 'vitest'
import { sanitizeError } from './errors'

describe('sanitizeError', () => {
  it('extracts message from Error instance', () => {
    expect(sanitizeError(new Error('Something failed'))).toBe('Something failed')
  })

  it('converts non-Error to string', () => {
    expect(sanitizeError('raw string error')).toBe('raw string error')
    expect(sanitizeError(42)).toBe('42')
  })

  it('strips /home paths', () => {
    const err = new Error('Failed to read /home/user/.config/agent-desktop/agent.db')
    expect(sanitizeError(err)).toBe('Failed to read [path]')
  })

  it('strips /root paths', () => {
    expect(sanitizeError('Error at /root/.config/app/data')).toBe('Error at [path]')
  })

  it('strips /Users paths (macOS)', () => {
    expect(sanitizeError('ENOENT: /Users/dev/project/file.ts')).toBe('ENOENT: [path]')
  })

  it('strips /tmp paths', () => {
    expect(sanitizeError('Cannot access /tmp/test-agent/session')).toBe('Cannot access [path]')
  })

  it('strips /var paths', () => {
    expect(sanitizeError('Log at /var/log/agent.log')).toBe('Log at [path]')
  })

  it('strips multiple paths in one message', () => {
    const msg = 'Copy /home/a/file to /home/b/dest failed'
    expect(sanitizeError(msg)).toBe('Copy [path] to [path] failed')
  })

  it('preserves message without paths', () => {
    expect(sanitizeError('Invalid input')).toBe('Invalid input')
  })

  it('handles null/undefined via String()', () => {
    expect(sanitizeError(null)).toBe('null')
    expect(sanitizeError(undefined)).toBe('undefined')
  })
})
