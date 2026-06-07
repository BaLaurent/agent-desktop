import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock streaming (sendChunk + pendingRequests)
const mockSendChunk = vi.fn()
vi.mock('../streaming', async () => {
  const actual = await vi.importActual<typeof import('../streaming')>('../streaming')
  return {
    ...actual,
    sendChunk: (...args: unknown[]) => mockSendChunk(...args),
    pendingRequests: new Map(),
  }
})

// Mock canUseTool factory — returns a spy so tests can introspect the fn
const mockCanUseToolFn = vi.fn().mockResolvedValue({ behavior: 'allow', updatedInput: {} })
vi.mock('../canUseTool', () => ({
  createCanUseTool: vi.fn(() => mockCanUseToolFn),
}))

// Mock piExtensionBridge
vi.mock('../piExtensionBridge', () => ({
  createBridge: vi.fn(() => ({ emitSystemMessage: vi.fn(), emitTaskNotification: vi.fn() })),
}))

// Mock the parity extension factory — it touches the PI API which isn't available in tests
vi.mock('../../../extensions/agent-desktop-parity', () => ({
  default: vi.fn(() => ({})),
}))

import { buildSessionConfig } from './buildSessionConfig'
import { createCanUseTool } from '../canUseTool'
import type { AgentToolResult } from '@mariozechner/pi-coding-agent'

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function makePiSdk(overrides?: {
  resourceLoaderOpts?: Record<string, unknown>
  tools?: Array<{ name: string; execute: (...args: unknown[]) => Promise<AgentToolResult> }>
}) {
  const mockReload = vi.fn().mockResolvedValue(undefined)
  const capturedOpts: Record<string, unknown>[] = []

  class FakeDefaultResourceLoader {
    constructor(opts: Record<string, unknown>) {
      capturedOpts.push(opts)
      if (overrides?.resourceLoaderOpts) Object.assign(opts, overrides.resourceLoaderOpts)
    }
    reload = mockReload
  }

  return {
    DefaultResourceLoader: FakeDefaultResourceLoader,
    codingTools: overrides?.tools ?? [],
    mockReload,
    capturedOpts,
  }
}

function makeBasicOptions(piSdk: ReturnType<typeof makePiSdk>) {
  return {
    aiSettings: { cwd: '/project', permissionMode: 'bypassPermissions' as const },
    conversationId: 5,
    convKey: 5,
    piSdk: piSdk as unknown as Parameters<typeof buildSessionConfig>[0]['piSdk'],
    sessionStore: new Map<string, unknown>(),
  }
}

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

describe('buildSessionConfig — resourceLoader', () => {
  beforeEach(() => { mockSendChunk.mockClear(); vi.mocked(createCanUseTool).mockClear() })

  it('calls resourceLoader.reload()', async () => {
    const sdk = makePiSdk()
    await buildSessionConfig(makeBasicOptions(sdk))
    expect(sdk.mockReload).toHaveBeenCalledOnce()
  })

  it('passes cwd to DefaultResourceLoader', async () => {
    const sdk = makePiSdk()
    await buildSessionConfig(makeBasicOptions(sdk))
    expect(sdk.capturedOpts[0]).toMatchObject({ cwd: '/project' })
  })

  it('falls back to process.cwd() when aiSettings is undefined', async () => {
    const sdk = makePiSdk()
    const result = await buildSessionConfig({
      aiSettings: undefined,
      conversationId: undefined,
      convKey: 0,
      piSdk: sdk as unknown as Parameters<typeof buildSessionConfig>[0]['piSdk'],
      sessionStore: new Map(),
    })
    expect(sdk.capturedOpts[0]).toMatchObject({ cwd: process.cwd() })
    expect(result).toBeDefined()
  })

  it('sets noSkills, noPromptTemplates, noThemes to true', async () => {
    const sdk = makePiSdk()
    await buildSessionConfig(makeBasicOptions(sdk))
    expect(sdk.capturedOpts[0]).toMatchObject({ noSkills: true, noPromptTemplates: true, noThemes: true })
  })

  it('sets additionalExtensionPaths when piExtensionsDir is provided', async () => {
    const sdk = makePiSdk()
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = { ...opts.aiSettings, piExtensionsDir: '/my/extensions' }
    await buildSessionConfig(opts)
    expect(sdk.capturedOpts[0]).toMatchObject({ additionalExtensionPaths: ['/my/extensions'] })
  })

  it('does NOT set additionalExtensionPaths when piExtensionsDir is absent', async () => {
    const sdk = makePiSdk()
    await buildSessionConfig(makeBasicOptions(sdk))
    expect(sdk.capturedOpts[0]).not.toHaveProperty('additionalExtensionPaths')
  })

  it('sets extensionsOverride only when piDisabledExtensions is non-empty', async () => {
    const sdk = makePiSdk()
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = { ...opts.aiSettings, piDisabledExtensions: ['/ext/bad'] }
    await buildSessionConfig(opts)
    expect(sdk.capturedOpts[0]).toHaveProperty('extensionsOverride')
    expect(typeof (sdk.capturedOpts[0] as Record<string, unknown>).extensionsOverride).toBe('function')
  })

  it('does NOT set extensionsOverride when piDisabledExtensions is empty', async () => {
    const sdk = makePiSdk()
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = { ...opts.aiSettings, piDisabledExtensions: [] }
    await buildSessionConfig(opts)
    expect(sdk.capturedOpts[0]).not.toHaveProperty('extensionsOverride')
  })

  it('extensionsOverride filters disabled extension paths from result', async () => {
    const sdk = makePiSdk()
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = { ...opts.aiSettings, piDisabledExtensions: ['/ext/disabled'] }
    await buildSessionConfig(opts)
    const override = (sdk.capturedOpts[0] as Record<string, { (arg: unknown): unknown }>).extensionsOverride as (r: unknown) => { extensions: Array<{ resolvedPath: string }> }
    const filtered = override({ extensions: [{ resolvedPath: '/ext/ok' }, { resolvedPath: '/ext/disabled' }] })
    expect(filtered.extensions).toHaveLength(1)
    expect(filtered.extensions[0].resolvedPath).toBe('/ext/ok')
  })
})

describe('buildSessionConfig — bypass + permissionMode', () => {
  beforeEach(() => { vi.mocked(createCanUseTool).mockClear() })

  it('bypass=true when permissionMode is bypassPermissions', async () => {
    const sdk = makePiSdk()
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = { ...opts.aiSettings, permissionMode: 'bypassPermissions' }
    const result = await buildSessionConfig(opts)
    expect(result.bypass).toBe(true)
  })

  it('bypass=false when permissionMode is default', async () => {
    const sdk = makePiSdk()
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = { ...opts.aiSettings, permissionMode: 'default' }
    const result = await buildSessionConfig(opts)
    expect(result.bypass).toBe(false)
  })

  it('defaults to bypassPermissions (bypass=true) when permissionMode is absent', async () => {
    const sdk = makePiSdk()
    const opts = makeBasicOptions(sdk)
    // @ts-expect-error - testing missing key
    delete opts.aiSettings.permissionMode
    const result = await buildSessionConfig(opts)
    expect(result.bypass).toBe(true)
  })
})

describe('buildSessionConfig — schedulerCustomTool', () => {
  it('always returns schedulerCustomTool as null (resolved by orchestrator)', async () => {
    const sdk = makePiSdk()
    const result = await buildSessionConfig(makeBasicOptions(sdk))
    expect(result.schedulerCustomTool).toBeNull()
  })
})

describe('buildSessionConfig — gatedCodingTools CWD restriction', () => {
  beforeEach(() => { mockSendChunk.mockClear() })

  it('denies read tool on path outside whitelist', async () => {
    const fakeReadTool = {
      name: 'read',
      execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'contents' }] }),
    }
    const sdk = makePiSdk({ tools: [fakeReadTool] })
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = {
      ...opts.aiSettings,
      permissionMode: 'bypassPermissions',
      cwdWhitelist: [{ path: '/project', access: 'readwrite' }],
    }
    const result = await buildSessionConfig(opts)

    // read tool targeting outside allowed paths
    const res = await result.gatedCodingTools[0].execute('c1', { path: '/etc/passwd' }, undefined, undefined)
    expect((res.content[0] as { text: string }).text).toContain('Access denied')
    expect(fakeReadTool.execute).not.toHaveBeenCalled()
  })

  it('allows read tool on path inside cwd when no whitelist', async () => {
    const fakeReadTool = {
      name: 'read',
      execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'contents' }] }),
    }
    const sdk = makePiSdk({ tools: [fakeReadTool] })
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = {
      ...opts.aiSettings,
      permissionMode: 'bypassPermissions',
      cwdWhitelist: [], // empty = no read enforcement
    }
    const result = await buildSessionConfig(opts)

    const res = await result.gatedCodingTools[0].execute('c1', { path: '/etc/passwd' }, undefined, undefined)
    // Read restriction is NOT active with empty whitelist — should pass through
    expect((res.content[0] as { text: string }).text).toBe('contents')
    expect(fakeReadTool.execute).toHaveBeenCalled()
  })

  it('denies write tool on path outside cwd even without whitelist', async () => {
    const fakeWriteTool = {
      name: 'write',
      execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'written' }] }),
    }
    const sdk = makePiSdk({ tools: [fakeWriteTool] })
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = {
      ...opts.aiSettings,
      cwd: '/project',
      permissionMode: 'bypassPermissions',
      cwdWhitelist: [],
    }
    const result = await buildSessionConfig(opts)

    const res = await result.gatedCodingTools[0].execute('c1', { path: '/etc/shadow' }, undefined, undefined)
    expect((res.content[0] as { text: string }).text).toContain('Access denied')
    expect(fakeWriteTool.execute).not.toHaveBeenCalled()
  })

  it('supports file_path param alias for path detection', async () => {
    const fakeWriteTool = {
      name: 'write',
      execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'written' }] }),
    }
    const sdk = makePiSdk({ tools: [fakeWriteTool] })
    const opts = makeBasicOptions(sdk)
    opts.aiSettings = {
      ...opts.aiSettings,
      cwd: '/project',
      permissionMode: 'bypassPermissions',
      cwdWhitelist: [],
    }
    const result = await buildSessionConfig(opts)

    const res = await result.gatedCodingTools[0].execute('c1', { file_path: '/etc/shadow' }, undefined, undefined)
    expect((res.content[0] as { text: string }).text).toContain('Access denied')
  })
})
