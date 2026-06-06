/** Gating strategy for continuous voice mode. */
export type GateMode = 'wakeword' | 'intent'

/** A finalized, transcribed utterance with its VAD time span (ms, same clock as recordWake). */
export interface Utterance {
  text: string
  startedAt: number
  endedAt: number
}

/** Why the gate ignored an utterance (for subtle UX feedback). */
export type GateIgnoreReason = 'empty' | 'no-wakeword' | 'not-addressed' | 'classify-error'

export type GateDecision =
  | { action: 'send'; text: string }
  | { action: 'ignore'; reason: GateIgnoreReason }

export interface VoiceGateConfig {
  mode: GateMode
  /** Wakeword phrase, used only for cosmetic leading-strip of the transcript. */
  wakeword: string
  /** After an AI exchange, accept the next utterance with no wake/LLM for this long. 0 = off. */
  followupWindowMs: number
}

export interface VoiceGateDeps {
  /** Read live config each evaluation (settings can change mid-session). */
  getConfig: () => VoiceGateConfig
  /** Intent-mode classifier (renderer → core IPC). Rejects on error → fail-closed. */
  classifyIntent: (text: string) => Promise<{ addressed: boolean }>
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

export interface VoiceGate {
  /** Hotword engine pushes each detection here (timestamp on the same clock as utterances). */
  recordWake(timestampMs: number): void
  /** Decide whether a finalized utterance should be sent to the AI. */
  evaluate(utterance: Utterance): Promise<GateDecision>
  /** Call when an AI exchange finishes — (re)opens the follow-up window. */
  notifyExchangeComplete(): void
  /** Invalidate any in-flight classification (e.g. on stop/unmount). */
  dispose(): void
}
