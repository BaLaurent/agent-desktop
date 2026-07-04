import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentEngine, noopPlatformIO, noopSystemUI, noopHookRunner } from '../core'
import type { Broadcaster } from '../core'
import {
  LOCAL_ONLY_CHANNELS,
  WS_BLOCKED_CHANNELS,
  isLocalOnly,
  isWsBlocked,
  OriginDeniedError,
} from '../core/dispatch-allowlist'
import { isClaudeModel } from '../core/services/summarization'

describe('headless engine with dispatch', () => {
  let engine: AgentEngine
  const dbPath = join(tmpdir(), `agent-headless-test-${Date.now()}.db`)
  const themesDir = join(tmpdir(), `agent-themes-test-${Date.now()}`)

  beforeAll(async () => {
    const broadcaster: Broadcaster = { broadcast: () => {} }
    engine = new AgentEngine({
      dbPath,
      themesDir,
      broadcaster,
      platformIO: noopPlatformIO,
      systemUI: noopSystemUI,
      hookRunner: noopHookRunner,
    })
    await engine.init()
  })

  afterAll(async () => {
    await engine.shutdown()
  })

  it('dispatch is populated after init', () => {
    expect(engine.dispatch.has('settings:get')).toBe(true)
    expect(engine.dispatch.has('settings:set')).toBe(true)
    expect(engine.dispatch.has('folders:list')).toBe(true)
    expect(engine.dispatch.has('conversations:list')).toBe(true)
    expect(engine.dispatch.has('messages:send')).toBe(true)
  })

  it('settings:get returns object via dispatch', async () => {
    const handler = engine.dispatch.get('settings:get')!
    const result = await handler()
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('settings:set + get round-trip via dispatch', async () => {
    const set = engine.dispatch.get('settings:set')!
    const get = engine.dispatch.get('settings:get')!
    await set('theme', 'dark-test')
    const all = await get() as Record<string, string>
    expect(all['theme']).toBe('dark-test')
  })

  // Validates that the cherry-picked models handler from worktree-remediation-wave-1
  // (commit 98640d3) is wired via core/handlers/index.ts and reachable through
  // the headless engine dispatch.
  it('models:list and models:refresh are registered after init', () => {
    expect(engine.dispatch.has('models:list')).toBe(true)
    expect(engine.dispatch.has('models:refresh')).toBe(true)
  })

  it('models:list returns ModelOption[] for default backend', async () => {
    const handler = engine.dispatch.get('models:list')!
    const result = await handler() as Array<{ value: string; label: string }>
    expect(Array.isArray(result)).toBe(true)
    if (result.length > 0) {
      expect(result[0]).toHaveProperty('value')
      expect(result[0]).toHaveProperty('label')
    }
  })
})

// dispatch-allowlist is policy data: no engine required, just an invariant check.
// Regressions here mean the security audit findings (2026-04-23) silently degrade.
describe('dispatch-allowlist — policy invariants', () => {
  it('sensitive local-only channels are flagged', () => {
    expect(isLocalOnly('mcp:addServer')).toBe(true)
    expect(isLocalOnly('mcp:updateServer')).toBe(true)
    expect(isLocalOnly('mcp:testConnection')).toBe(true)
  })

  it('ws-blocked channels are flagged', () => {
    expect(isWsBlocked('server:start')).toBe(true)
    expect(isWsBlocked('server:stop')).toBe(true)
  })

  it('benign channels pass through both filters', () => {
    expect(isLocalOnly('conversations:list')).toBe(false)
    expect(isWsBlocked('conversations:list')).toBe(false)
  })

  it('OriginDeniedError exposes channel + origin for diagnostics', () => {
    const err = new OriginDeniedError('mcp:addServer', 'ws')
    expect(err).toBeInstanceOf(Error)
    expect(err.channel).toBe('mcp:addServer')
    expect(err.origin).toBe('ws')
  })

  it('policy sets are non-empty', () => {
    expect(LOCAL_ONLY_CHANNELS.size).toBeGreaterThan(0)
    expect(WS_BLOCKED_CHANNELS.size).toBeGreaterThan(0)
  })
})

// Validates that the WIP-recovered summarization changes (PI model context
// resolution) did NOT revert the Phase 6 summarizeWithModel router.
describe('summarization — Claude vs PI router', () => {
  it('isClaudeModel routes claude-* to Claude SDK path', () => {
    expect(isClaudeModel('claude-sonnet-4-6')).toBe(true)
    expect(isClaudeModel('claude-opus-4-7')).toBe(true)
    expect(isClaudeModel('claude-haiku-4-5')).toBe(true)
  })

  it('isClaudeModel routes non-Claude models to PI path', () => {
    expect(isClaudeModel('gpt-4o-mini')).toBe(false)
    expect(isClaudeModel('gemini-2.5')).toBe(false)
    expect(isClaudeModel('llama-3-70b')).toBe(false)
  })
})
