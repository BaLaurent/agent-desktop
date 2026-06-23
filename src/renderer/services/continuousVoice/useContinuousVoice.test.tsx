import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Captured engine callbacks + spies, shared with the mock factory (vi.hoisted: factories are hoisted above module vars).
const h = vi.hoisted(() => ({
  cb: null as null | { onUtterance: (u: { text: string; startedAt: number; endedAt: number }) => Promise<void> },
  engine: { stop: vi.fn(), suspend: vi.fn(), resume: vi.fn() },
  gate: { evaluate: vi.fn(), recordWake: vi.fn(), notifyExchangeComplete: vi.fn(), dispose: vi.fn() },
  flags: { pauseDuringProcessing: true },
}))

vi.mock('./engine', () => ({
  startContinuousVoiceEngine: (_s: unknown, _c: unknown, cb: typeof h.cb) => {
    h.cb = cb
    return h.engine
  },
}))
vi.mock('../voiceGate', () => ({ createVoiceGate: () => h.gate }))
vi.mock('../hotword', () => ({ createHotword: vi.fn() }))
vi.mock('./config', () => ({
  readContinuousVoiceFlags: () => ({ enabled: true, pauseDuringTts: true, pauseDuringProcessing: h.flags.pauseDuringProcessing }),
  readGateConfig: () => ({ mode: 'intent', wakeword: 'hey clawd', followupWindowMs: 8000 }),
  readEngineConfig: () => ({ vad: {}, preSpeechPadMs: 200 }),
  readHotwordConfig: () => ({}),
}))
vi.mock('../../stores/ttsStore', () => ({ useTtsStore: (sel: (s: { speakingMessageId: number | null }) => unknown) => sel({ speakingMessageId: null }) }))

import { useContinuousVoice } from './useContinuousVoice'
import { useContinuousVoiceStore } from './continuousVoiceStore'

beforeEach(() => {
  vi.clearAllMocks()
  h.cb = null
  h.flags.pauseDuringProcessing = true
  useContinuousVoiceStore.getState().reset()
  ;(navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
  }
})

async function startHook(onSend = vi.fn()) {
  const { result } = renderHook(() => useContinuousVoice({ conversationId: 1, onSend }))
  await act(async () => {
    await result.current.start()
  })
  return { result, onSend }
}

describe('useContinuousVoice processing + suspension', () => {
  it('addressed: classifying → replying, suspends, then resumes + clears on exchange complete', async () => {
    h.gate.evaluate.mockResolvedValue({ action: 'send', text: 'turn on the lights' })
    const { result, onSend } = await startHook()

    await act(async () => {
      await h.cb!.onUtterance({ text: 'turn on the lights', startedAt: 0, endedAt: 1 })
    })
    expect(useContinuousVoiceStore.getState().processing).toBe('replying')
    expect(h.engine.suspend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('turn on the lights')

    act(() => result.current.notifyExchangeComplete())
    expect(useContinuousVoiceStore.getState().processing).toBeNull()
    expect(h.engine.resume).toHaveBeenCalledTimes(1)
    expect(h.gate.notifyExchangeComplete).toHaveBeenCalledTimes(1)
  })

  it('not addressed: classifying → null + resume immediately, no send', async () => {
    h.gate.evaluate.mockResolvedValue({ action: 'ignore', reason: 'not-addressed' })
    const { onSend } = await startHook()

    await act(async () => {
      await h.cb!.onUtterance({ text: 'so anyway', startedAt: 0, endedAt: 1 })
    })
    expect(useContinuousVoiceStore.getState().processing).toBeNull()
    expect(h.engine.suspend).toHaveBeenCalledTimes(1)
    expect(h.engine.resume).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('toggle off: still sets processing for feedback but never suspends/resumes', async () => {
    h.flags.pauseDuringProcessing = false
    h.gate.evaluate.mockResolvedValue({ action: 'send', text: 'hi' })
    const { result } = await startHook()

    await act(async () => {
      await h.cb!.onUtterance({ text: 'hi', startedAt: 0, endedAt: 1 })
    })
    expect(useContinuousVoiceStore.getState().processing).toBe('replying')
    expect(h.engine.suspend).not.toHaveBeenCalled()

    act(() => result.current.notifyExchangeComplete())
    expect(useContinuousVoiceStore.getState().processing).toBeNull()
    expect(h.engine.resume).not.toHaveBeenCalled()
  })
})
