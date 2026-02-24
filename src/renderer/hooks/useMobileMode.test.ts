import { describe, it, expect, afterEach } from 'vitest'
import { useMobileMode } from './useMobileMode'

describe('useMobileMode', () => {
  afterEach(() => {
    delete (window as any).__AGENT_WEB_MODE__
  })

  it('returns false when __AGENT_WEB_MODE__ is not set', () => {
    expect(useMobileMode()).toBe(false)
  })

  it('returns true when __AGENT_WEB_MODE__ is true', () => {
    ;(window as any).__AGENT_WEB_MODE__ = true
    expect(useMobileMode()).toBe(true)
  })

  it('returns false when __AGENT_WEB_MODE__ is falsy', () => {
    ;(window as any).__AGENT_WEB_MODE__ = 0
    expect(useMobileMode()).toBe(false)
  })
})
