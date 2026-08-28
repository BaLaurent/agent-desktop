import { describe, it, expect } from 'vitest'
import {
  WS_BLOCKED_CHANNELS,
  ELECTRON_ONLY_CHANNELS,
  LOCAL_WS_ALLOWED_CHANNELS,
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
  ] as const

  it.each(stillBlocked)('%s is refused on the WS bridge', (channel) => {
    expect(isWsBlocked(channel)).toBe(true)
    expect(() => assertOriginAllowed(channel, 'ws')).toThrow(OriginDeniedError)
    // Electron origin is fine — the lock is purely on the WS bridge.
    expect(() => assertOriginAllowed(channel, 'electron')).not.toThrow()
  })
})

describe('dispatch-allowlist — loopback WS origin (ws-local)', () => {
  it('LOCAL_WS_ALLOWED_CHANNELS contains exactly the nine documented entries', () => {
    expect(LOCAL_WS_ALLOWED_CHANNELS.size).toBe(9)
    const expected = [
      'mcp:addServer',
      'mcp:updateServer',
      'mcp:testConnection',
      'git:fetch',
      'git:checkout',
      'files:openTerminalHere',
      'files:prepareSession',
      'system:purgeAll',
      'system:purgeConversations',
    ]
    for (const channel of expected) {
      expect(LOCAL_WS_ALLOWED_CHANNELS.has(channel)).toBe(true)
    }
  })

  it('every LOCAL_WS_ALLOWED_CHANNELS entry is also in ELECTRON_ONLY_CHANNELS', () => {
    for (const channel of LOCAL_WS_ALLOWED_CHANNELS) {
      expect(ELECTRON_ONLY_CHANNELS.has(channel)).toBe(true)
    }
  })

  it('mcp:testConnection is refused for origin ws', () => {
    expect(() => assertOriginAllowed('mcp:testConnection', 'ws')).toThrow(OriginDeniedError)
  })

  it('mcp:testConnection is allowed for origin ws-local', () => {
    expect(() => assertOriginAllowed('mcp:testConnection', 'ws-local')).not.toThrow()
  })

  it('server:setPassword is refused for both ws and ws-local', () => {
    expect(() => assertOriginAllowed('server:setPassword', 'ws')).toThrow(OriginDeniedError)
    expect(() => assertOriginAllowed('server:setPassword', 'ws-local')).toThrow(OriginDeniedError)
  })

  it('system:getInfo is refused for both ws and ws-local (still in ELECTRON_ONLY)', () => {
    // system:getInfo stayed in ELECTRON_ONLY_CHANNELS — used as a stand-in for
    // channels still gated to the Electron origin after the sibling agent
    // moved jupyter/openscad/pi:listExtensions into core.
    expect(ELECTRON_ONLY_CHANNELS.has('system:getInfo')).toBe(true)
    expect(LOCAL_WS_ALLOWED_CHANNELS.has('system:getInfo')).toBe(false)
    expect(() => assertOriginAllowed('system:getInfo', 'ws')).toThrow(OriginDeniedError)
    expect(() => assertOriginAllowed('system:getInfo', 'ws-local')).toThrow(OriginDeniedError)
  })

  it('a plain non-gated channel still works for ws-local', () => {
    // settings:set is not in either block-list, so it must pass for every origin.
    expect(() => assertOriginAllowed('settings:set', 'ws-local')).not.toThrow()
  })

  it('a channel in ELECTRON_ONLY but NOT in LOCAL_WS_ALLOWED is refused for ws-local', () => {
    // system:openExternal is ELECTRON_ONLY and not on the documented loopback
    // exception list, so it must stay refused for ws-local.
    expect(ELECTRON_ONLY_CHANNELS.has('system:openExternal')).toBe(true)
    expect(LOCAL_WS_ALLOWED_CHANNELS.has('system:openExternal')).toBe(false)
    expect(() => assertOriginAllowed('system:openExternal', 'ws-local')).toThrow(OriginDeniedError)
  })
})
