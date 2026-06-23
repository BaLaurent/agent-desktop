import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./messages', () => ({ getAISettings: vi.fn() }))
vi.mock('../services/summarization', () => ({ summarizeWithModel: vi.fn() }))
vi.mock('../services/streaming', () => ({ injectApiKeyEnv: vi.fn(() => vi.fn()) }))
vi.mock('../services/modelBackendMap', () => ({ mapModelToBackend: vi.fn((m: string) => m) }))
vi.mock('../utils/db', () => ({ getSetting: vi.fn(() => '') }))
vi.mock('./messages/knowledgeBase', () => ({ getAgentDirectives: vi.fn(() => ({ name: undefined })) }))

import { registerVoiceIntentHandlers } from './voiceIntent'
import { getAISettings } from './messages'
import { summarizeWithModel } from '../services/summarization'
import { injectApiKeyEnv } from '../services/streaming'
import { mapModelToBackend } from '../services/modelBackendMap'
import { getSetting } from '../utils/db'
import { getAgentDirectives } from './messages/knowledgeBase'

const aiSettings = {
  model: 'claude-sonnet-4-6',
  sdkBackend: 'claude-agent-sdk',
  lastModelByBackend: {},
  apiKey: undefined,
  baseUrl: undefined,
  cwd: '/work',
}

function getHandler() {
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>()
  const registrar = { handle: (ch: string, fn: (...a: unknown[]) => Promise<unknown>) => handlers.set(ch, fn) }
  registerVoiceIntentHandlers(registrar as never, {} as never, { sessionsBase: '/tmp' })
  return handlers.get('voice:classifyIntent')!
}

describe('voice:classifyIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getAISettings as ReturnType<typeof vi.fn>).mockReturnValue(aiSettings)
    ;(getSetting as ReturnType<typeof vi.fn>).mockReturnValue('')
  })

  it('returns addressed:false without calling the model for an invalid conversation id', async () => {
    const handler = getHandler()
    expect(await handler(null, 0, 'what time is it')).toEqual({ addressed: false })
    expect(summarizeWithModel).not.toHaveBeenCalled()
  })

  it('returns addressed:false without calling the model for empty text', async () => {
    const handler = getHandler()
    expect(await handler(null, 1, '   ')).toEqual({ addressed: false })
    expect(summarizeWithModel).not.toHaveBeenCalled()
  })

  it('parses a leading "yes" as addressed', async () => {
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockResolvedValue('Yes')
    const handler = getHandler()
    expect(await handler(null, 1, 'what time is it')).toEqual({ addressed: true })
  })

  it('parses anything not starting with y as not addressed', async () => {
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockResolvedValue('No.')
    const handler = getHandler()
    expect(await handler(null, 1, 'ugh tired')).toEqual({ addressed: false })
  })

  it('templates the utterance into the prompt', async () => {
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockResolvedValue('yes')
    const handler = getHandler()
    await handler(null, 1, 'turn on the lights')
    const [prompt] = (summarizeWithModel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(prompt).toContain('turn on the lights')
    expect(prompt).not.toContain('{utterance}')
  })

  it('uses the global intent model override when set', async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, key: string) =>
      key === 'continuousVoice_intentModel' ? 'claude-haiku-4-5' : '',
    )
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockResolvedValue('yes')
    const handler = getHandler()
    await handler(null, 1, 'hello')
    const [, model] = (summarizeWithModel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(model).toBe('claude-haiku-4-5')
  })

  it('with a dedicated base URL: skips remapping, forces the claude backend, injects the dedicated endpoint', async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, key: string) => {
      if (key === 'continuousVoice_intentModel') return 'qwen2.5'
      if (key === 'continuousVoice_intentBaseUrl') return 'http://localhost:11434'
      if (key === 'continuousVoice_intentApiKey') return 'local-key'
      return ''
    })
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockResolvedValue('yes')
    const handler = getHandler()
    await handler(null, 1, 'hello')

    expect(mapModelToBackend).not.toHaveBeenCalled()
    const [, model, opts] = (summarizeWithModel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(model).toBe('qwen2.5')
    expect(opts).toMatchObject({
      backend: 'claude',
      baseUrl: 'http://localhost:11434',
      apiKey: 'local-key',
    })
    expect(injectApiKeyEnv).toHaveBeenCalledWith('local-key', 'http://localhost:11434')
  })

  it('cascades to the conversation endpoint when the dedicated fields are empty', async () => {
    ;(getAISettings as ReturnType<typeof vi.fn>).mockReturnValue({
      ...aiSettings,
      apiKey: 'conv-key',
      baseUrl: 'https://conv.example',
    })
    ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, key: string) =>
      key === 'continuousVoice_intentBaseUrl' ? 'http://localhost:1234' : '',
    )
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockResolvedValue('yes')
    const handler = getHandler()
    await handler(null, 1, 'hello')

    const [, , opts] = (summarizeWithModel as ReturnType<typeof vi.fn>).mock.calls[0]
    // dedicated base URL set but no dedicated key → key falls back to the conversation
    expect(opts).toMatchObject({ backend: 'claude', baseUrl: 'http://localhost:1234', apiKey: 'conv-key' })
  })

  it('with a base URL but no key anywhere (OAuth + local model): still injects the base URL via a placeholder key', async () => {
    // aiSettings has no apiKey (OAuth) and the user leaves the gate key empty —
    // the common local-model case. injectApiKeyEnv drops the base URL on a falsy
    // key, so the handler must pass a non-empty key to keep ANTHROPIC_BASE_URL set.
    ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, key: string) => {
      if (key === 'continuousVoice_intentModel') return 'qwen2.5'
      if (key === 'continuousVoice_intentBaseUrl') return 'http://localhost:11434'
      return ''
    })
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockResolvedValue('yes')
    const handler = getHandler()
    await handler(null, 1, 'hello')

    const [injectedKey, injectedBaseUrl] = (injectApiKeyEnv as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(injectedKey).toBeTruthy()
    expect(injectedBaseUrl).toBe('http://localhost:11434')
    const [, , opts] = (summarizeWithModel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(opts).toMatchObject({ backend: 'claude', baseUrl: 'http://localhost:11434' })
    expect(opts.apiKey).toBeTruthy()
  })

  it('keeps the current behavior (remap, no forced backend) when no dedicated base URL is set', async () => {
    ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, key: string) =>
      key === 'continuousVoice_intentModel' ? 'claude-haiku-4-5' : '',
    )
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockResolvedValue('yes')
    const handler = getHandler()
    await handler(null, 1, 'hello')

    expect(mapModelToBackend).toHaveBeenCalled()
    const [, , opts] = (summarizeWithModel as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(opts.backend).toBeUndefined()
  })

  it('propagates model errors (renderer applies fail-closed)', async () => {
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no creds'))
    const handler = getHandler()
    await expect(handler(null, 1, 'hello')).rejects.toThrow('no creds')
  })

  it('substitutes {agent_name} with the resolved display name in the prompt', async () => {
    ;(getAgentDirectives as ReturnType<typeof vi.fn>).mockReturnValue({ name: 'Clawd' })
    ;(summarizeWithModel as ReturnType<typeof vi.fn>).mockResolvedValue('yes')
    const handler = getHandler()
    await handler(null, 1, 'turn the lights on')
    const promptArg = (summarizeWithModel as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(promptArg).toContain('voice assistant named "Clawd"')
    expect(promptArg).toContain('turn the lights on')
    expect(promptArg).not.toContain('{agent_name}')
    expect(promptArg).not.toContain('{utterance}')
  })
})
