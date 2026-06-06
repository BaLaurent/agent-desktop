import { describe, it, expect, vi } from 'vitest'
import { createVoiceGate } from './createVoiceGate'
import type { Utterance, VoiceGateConfig, VoiceGateDeps } from './types'

function makeGate(
  config: Partial<VoiceGateConfig>,
  classifyIntent: VoiceGateDeps['classifyIntent'] = vi.fn().mockResolvedValue({ addressed: true }),
) {
  let clock = 10_000
  const cfg: VoiceGateConfig = { mode: 'wakeword', wakeword: 'hey clawd', followupWindowMs: 0, ...config }
  const gate = createVoiceGate({
    getConfig: () => cfg,
    classifyIntent,
    now: () => clock,
  })
  return { gate, classifyIntent, setClock: (t: number) => (clock = t), getClock: () => clock }
}

const utter = (text: string, startedAt: number, endedAt: number): Utterance => ({ text, startedAt, endedAt })

describe('createVoiceGate', () => {
  it('ignores an empty utterance', async () => {
    const { gate } = makeGate({})
    expect(await gate.evaluate(utter('   ', 0, 100))).toEqual({ action: 'ignore', reason: 'empty' })
  })

  describe('wakeword mode', () => {
    it('sends and strips when a wake event falls within the utterance span', async () => {
      const { gate } = makeGate({ mode: 'wakeword' })
      gate.recordWake(10_500)
      const d = await gate.evaluate(utter('hey clawd what time is it', 10_450, 11_200))
      expect(d).toEqual({ action: 'send', text: 'what time is it' })
    })

    it('still sends (unstripped) when STT dropped the wakeword but a wake fired', async () => {
      const { gate } = makeGate({ mode: 'wakeword' })
      gate.recordWake(10_500)
      const d = await gate.evaluate(utter('what time is it', 10_450, 11_200))
      expect(d).toEqual({ action: 'send', text: 'what time is it' })
    })

    it('ignores when no wake event correlates', async () => {
      const { gate } = makeGate({ mode: 'wakeword' })
      const d = await gate.evaluate(utter('just talking to myself', 10_450, 11_200))
      expect(d).toEqual({ action: 'ignore', reason: 'no-wakeword' })
    })

    it('accepts a wake slightly before VAD onset (engine latency window)', async () => {
      const { gate } = makeGate({ mode: 'wakeword' })
      gate.recordWake(10_250) // 200ms before startedAt 10_450, within 300ms lookback
      const d = await gate.evaluate(utter('hey clawd lights on', 10_450, 11_000))
      expect(d).toEqual({ action: 'send', text: 'lights on' })
    })

    it('ignores a wake that is too far before the utterance', async () => {
      const { gate } = makeGate({ mode: 'wakeword' })
      gate.recordWake(10_000) // 450ms before onset, outside lookback
      const d = await gate.evaluate(utter('hey clawd lights on', 10_450, 11_000))
      expect(d).toEqual({ action: 'ignore', reason: 'no-wakeword' })
    })

    it('ignores when only the wakeword was spoken (empty after strip)', async () => {
      const { gate } = makeGate({ mode: 'wakeword' })
      gate.recordWake(10_500)
      const d = await gate.evaluate(utter('hey clawd', 10_450, 10_900))
      expect(d).toEqual({ action: 'ignore', reason: 'empty' })
    })

    it('arms on wake: a bare wake word, then a SEPARATE command utterance, sends the command', async () => {
      // The natural "Hey Clawd" … (pause) … "what time is it" pattern: VAD splits it in two and the
      // late hotword fires during the first. The wake arms the gate so the second utterance passes.
      const { gate } = makeGate({ mode: 'wakeword', followupWindowMs: 8000 })
      gate.recordWake(10_500)
      expect(await gate.evaluate(utter('hey clawd', 10_450, 10_900))).toEqual({ action: 'ignore', reason: 'empty' })
      // command has no wake in its own span, but the gate is armed → accepted
      expect(await gate.evaluate(utter('what time is it', 11_500, 12_500))).toEqual({ action: 'send', text: 'what time is it' })
    })
  })

  describe('intent mode', () => {
    it('sends when the classifier says addressed', async () => {
      const classify = vi.fn().mockResolvedValue({ addressed: true })
      const { gate } = makeGate({ mode: 'intent' }, classify)
      const d = await gate.evaluate(utter('what is the capital of France', 0, 500))
      expect(d).toEqual({ action: 'send', text: 'what is the capital of France' })
      expect(classify).toHaveBeenCalledWith('what is the capital of France')
    })

    it('ignores when the classifier says not addressed', async () => {
      const classify = vi.fn().mockResolvedValue({ addressed: false })
      const { gate } = makeGate({ mode: 'intent' }, classify)
      expect(await gate.evaluate(utter('ugh so tired', 0, 500))).toEqual({
        action: 'ignore',
        reason: 'not-addressed',
      })
    })

    it('fails CLOSED (ignore) when the classifier throws', async () => {
      const classify = vi.fn().mockRejectedValue(new Error('no creds'))
      const { gate } = makeGate({ mode: 'intent' }, classify)
      expect(await gate.evaluate(utter('hello there', 0, 500))).toEqual({
        action: 'ignore',
        reason: 'classify-error',
      })
    })

    it('discards a superseded verdict when a newer utterance arrives mid-classification', async () => {
      let resolveFirst: (v: { addressed: boolean }) => void = () => {}
      const classify = vi
        .fn()
        .mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)))
        .mockResolvedValueOnce({ addressed: false })
      const { gate } = makeGate({ mode: 'intent' }, classify)

      const firstP = gate.evaluate(utter('first', 0, 500)) // hangs (gen 1)
      await gate.evaluate(utter('second', 600, 1000)) // bumps to gen 2, resolves
      resolveFirst({ addressed: true }) // first would say send, but it's stale now
      expect(await firstP).toEqual({ action: 'ignore', reason: 'not-addressed' })
    })
  })

  describe('follow-up window', () => {
    it('short-circuits to send after an exchange, in intent mode, with no classifier call', async () => {
      const classify = vi.fn().mockResolvedValue({ addressed: false })
      const { gate } = makeGate({ mode: 'intent', followupWindowMs: 8000 }, classify)
      gate.notifyExchangeComplete() // opens window at clock 10_000 → until 18_000
      const d = await gate.evaluate(utter('and what about tomorrow', 0, 500))
      expect(d).toEqual({ action: 'send', text: 'and what about tomorrow' })
      expect(classify).not.toHaveBeenCalled()
    })

    it('short-circuits to send in wakeword mode without a wake event', async () => {
      const { gate } = makeGate({ mode: 'wakeword', followupWindowMs: 8000 })
      gate.notifyExchangeComplete()
      const d = await gate.evaluate(utter('turn it off', 0, 500))
      expect(d).toEqual({ action: 'send', text: 'turn it off' })
    })

    it('reverts to normal gating once the window expires', async () => {
      const { gate, setClock } = makeGate({ mode: 'wakeword', followupWindowMs: 8000 })
      gate.notifyExchangeComplete() // window until 18_000
      setClock(18_001)
      const d = await gate.evaluate(utter('still talking', 18_100, 18_500))
      expect(d).toEqual({ action: 'ignore', reason: 'no-wakeword' })
    })

    it('is disabled when followupWindowMs is 0', async () => {
      const { gate } = makeGate({ mode: 'wakeword', followupWindowMs: 0 })
      gate.notifyExchangeComplete()
      const d = await gate.evaluate(utter('no follow up', 0, 500))
      expect(d).toEqual({ action: 'ignore', reason: 'no-wakeword' })
    })
  })
})
