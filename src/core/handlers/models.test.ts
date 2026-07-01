import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import { DispatchRegistry } from '../dispatch'
import { registerModelsHandlers, _resetModelsCache } from './models'
import { MODEL_OPTIONS } from '../types/constants'

const mockDiscoverOmpModels = vi.fn()
vi.mock('../services/pi/ompModels', () => ({
  discoverOmpModels: (...args: unknown[]) => mockDiscoverOmpModels(...args),
}))

describe('models handlers', () => {
  let dispatch: DispatchRegistry
  const originalFetch = globalThis.fetch
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

  beforeEach(() => {
    dispatch = new DispatchRegistry()
    registerModelsHandlers(dispatch)
    _resetModelsCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    vi.restoreAllMocks()
  })

  it('registers models:list and models:refresh', () => {
    expect(dispatch.has('models:list')).toBe(true)
    expect(dispatch.has('models:refresh')).toBe(true)
  })

  it('returns PI models when backend is pi', async () => {
    mockDiscoverOmpModels.mockResolvedValueOnce([
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
    ])

    const list = dispatch.get('models:list')!
    const result = (await list('pi')) as { value: string; label: string }[]

    expect(result).toEqual([{ value: 'openai/gpt-4o', label: 'GPT-4o' }])
    expect(mockDiscoverOmpModels).toHaveBeenCalledOnce()
  })

  it('returns static fallback when no credentials file', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/nonexistent/path/that/does/not/exist'
    const list = dispatch.get('models:list')!
    const result = (await list()) as { value: string; label: string }[]
    expect(result).toEqual(MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label })))
  })

  it('returns fetched models when API responds', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/agent-models-test'
    fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
    fs.writeFileSync(
      `${process.env.CLAUDE_CONFIG_DIR}/.credentials.json`,
      JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token' } }),
    )

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'claude-foo-1', display_name: 'Foo 1', type: 'model' },
            { id: 'claude-bar-2', display_name: 'Bar 2', type: 'model' },
          ],
          has_more: false,
          last_id: null,
        }),
        { status: 200 },
      ),
    ) as never

    const list = dispatch.get('models:list')!
    const result = (await list()) as { value: string; label: string }[]
    expect(result).toEqual([
      { value: 'claude-foo-1', label: 'Foo 1' },
      { value: 'claude-bar-2', label: 'Bar 2' },
    ])

    fs.rmSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true, force: true })
  })

  it('falls back to static list when fetch fails', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/agent-models-test-fail'
    fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
    fs.writeFileSync(
      `${process.env.CLAUDE_CONFIG_DIR}/.credentials.json`,
      JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token' } }),
    )

    globalThis.fetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as never
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const list = dispatch.get('models:list')!
    const result = (await list()) as { value: string; label: string }[]
    expect(result).toEqual(MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label })))

    fs.rmSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true, force: true })
  })

  it('models:refresh bypasses cache', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/agent-models-test-refresh'
    fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
    fs.writeFileSync(
      `${process.env.CLAUDE_CONFIG_DIR}/.credentials.json`,
      JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token' } }),
    )

    let callCount = 0
    globalThis.fetch = vi.fn(async () => {
      callCount++
      return new Response(
        JSON.stringify({
          data: [{ id: `claude-call-${callCount}`, display_name: `Call ${callCount}` }],
          has_more: false,
          last_id: null,
        }),
        { status: 200 },
      )
    }) as never

    const list = dispatch.get('models:list')!
    const refresh = dispatch.get('models:refresh')!

    await list()
    const cached = (await list()) as { value: string }[]
    expect(cached[0].value).toBe('claude-call-1')

    const refreshed = (await refresh()) as { value: string }[]
    expect(refreshed[0].value).toBe('claude-call-2')

    fs.rmSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true, force: true })
  })

  it('models:refresh uses PI discovery when backend is pi', async () => {
    mockDiscoverOmpModels.mockResolvedValueOnce([
      { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ])

    const refresh = dispatch.get('models:refresh')!
    const result = (await refresh('pi')) as { value: string; label: string }[]

    expect(result).toEqual([
      { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ])
  })
})
