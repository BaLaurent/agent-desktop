import { describe, it, expect } from 'vitest'
import {
  WS_BLOCKED_CHANNELS,
  ELECTRON_ONLY_CHANNELS,
  isWsBlocked,
  assertOriginAllowed,
  OriginDeniedError,
} from './dispatch-allowlist'

describe('dispatch-allowlist — settings:set parity with Electron', () => {
  it('settings:set is reachable over WebSocket', () => {
    expect(WS_BLOCKED_CHANNELS.has('settings:set')).toBe(false)
    expect(isWsBlocked('settings:set')).toBe(false)
  })

  it('settings:set is reachable from any origin', () => {
    expect(() => assertOriginAllowed('settings:set', 'electron')).not.toThrow()
    expect(() => assertOriginAllowed('settings:set', 'ws')).not.toThrow()
    expect(() => assertOriginAllowed('settings:set', 'discord')).not.toThrow()
    expect(() => assertOriginAllowed('settings:set', 'scheduler')).not.toThrow()
  })

  it('settings:set is NOT in the Electron-only set either', () => {
    expect(ELECTRON_ONLY_CHANNELS.has('settings:set')).toBe(false)
  })
})

describe('dispatch-allowlist — control-plane channels stay blocked over WS', () => {
  const stillBlocked = [
    'server:start',
    'server:stop',
    'server:getStatus',
    'server:setPassword',
    'server:clearPassword',
    'openscad:exportStl',
  ] as const

  it.each(stillBlocked)('%s is refused on the WS bridge', (channel) => {
    expect(isWsBlocked(channel)).toBe(true)
    expect(() => assertOriginAllowed(channel, 'ws')).toThrow(OriginDeniedError)
    // Electron origin is fine — the lock is purely on the WS bridge.
    expect(() => assertOriginAllowed(channel, 'electron')).not.toThrow()
  })
})
