/**
 * The continuous-voice gate: decides whether a finalized utterance reaches the AI.
 *
 * Stateful (the follow-up window + the rolling wake-event buffer make it so), hence a factory
 * rather than a pure function. It orchestrates two strategies behind one `evaluate`:
 *   - wakeword: send iff a hotword detection timestamp falls within the utterance's span
 *     (correlation, not text-match); the wakeword is then cosmetically stripped from the text.
 *   - intent: ask the injected classifier; fail-CLOSED (ignore) on error or negative.
 * A follow-up window short-circuits BOTH modes after an AI exchange, so natural back-and-forth
 * needs neither a repeated wakeword nor a repeated (paid) classification.
 */

import type { GateDecision, Utterance, VoiceGate, VoiceGateDeps } from './types'
import { stripWakeword } from './stripWakeword'

/** Allow a wake detection slightly before VAD onset (engine latency). */
const WAKE_LOOKBACK_MS = 300
/** Drop wake events older than this — bounds the buffer. */
const WAKE_RETENTION_MS = 15_000

export function createVoiceGate(deps: VoiceGateDeps): VoiceGate {
  const now = deps.now ?? (() => Date.now())
  const wakeEvents: number[] = []
  // Until this time, the gate accepts utterances without a fresh wake/classification. Set when the
  // hotword fires (so the COMMAND that follows the wake word is accepted — openWakeWord fires ~1s
  // late and the user often pauses after the wake word, so command and wake land in separate VAD
  // utterances) and after an AI exchange (conversational follow-up).
  let armedUntil = 0
  let generation = 0

  function arm(): void {
    const cfg = deps.getConfig()
    if (cfg.followupWindowMs > 0) armedUntil = now() + cfg.followupWindowMs
  }

  function recordWake(ts: number): void {
    wakeEvents.push(ts)
    const cutoff = now() - WAKE_RETENTION_MS
    while (wakeEvents.length > 0 && wakeEvents[0] < cutoff) wakeEvents.shift()
    arm() // a wake just happened — accept the command utterance that follows
  }

  function wakeWithin(startedAt: number, endedAt: number): boolean {
    const lo = startedAt - WAKE_LOOKBACK_MS
    return wakeEvents.some((t) => t >= lo && t <= endedAt)
  }

  const armed = (): boolean => armedUntil > 0 && now() < armedUntil

  async function evaluate(utterance: Utterance): Promise<GateDecision> {
    const text = utterance.text.trim()
    if (!text) return { action: 'ignore', reason: 'empty' }

    const cfg = deps.getConfig()

    if (cfg.mode === 'wakeword') {
      // Case 1: the wake fired DURING this utterance (one-breath "alexa, <command>") — strip the
      // wake word and send the remainder. A bare wake word leaves nothing: ignore, but `armedUntil`
      // is set so the next utterance (the command, said after a pause) is accepted by Case 2.
      if (wakeWithin(utterance.startedAt, utterance.endedAt)) {
        const cleaned = stripWakeword(text, cfg.wakeword).text
        return cleaned ? { action: 'send', text: cleaned } : { action: 'ignore', reason: 'empty' }
      }
      // Case 2: armed by a recent wake (or AI exchange) — this utterance is the command/follow-up.
      if (armed()) return { action: 'send', text }
      return { action: 'ignore', reason: 'no-wakeword' }
    }

    // intent mode — follow-up window short-circuits the (paid) classifier after an exchange.
    if (armed()) return { action: 'send', text }
    const myGen = ++generation
    try {
      const { addressed } = await deps.classifyIntent(text)
      if (myGen !== generation) return { action: 'ignore', reason: 'not-addressed' }
      return addressed ? { action: 'send', text } : { action: 'ignore', reason: 'not-addressed' }
    } catch {
      // fail-CLOSED: never send an unverified utterance.
      return { action: 'ignore', reason: 'classify-error' }
    }
  }

  function notifyExchangeComplete(): void {
    arm()
  }

  function dispose(): void {
    generation++
    wakeEvents.length = 0
    armedUntil = 0
  }

  return { recordWake, evaluate, notifyExchangeComplete, dispose }
}
