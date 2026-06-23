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
