import { create } from 'zustand'
import type { ContinuousPhase } from './engine'
import type { GateIgnoreReason } from '../voiceGate'

/**
 * Coarse UI state for a continuous-voice session. Deliberately holds ONLY low-frequency state —
 * the live level meter is pushed via an engine callback to a component ref, never through here,
 * to avoid 60fps re-renders.
 */
interface ContinuousVoiceState {
  active: boolean
  phase: ContinuousPhase
  error: string | null
  /** Last utterance the gate discarded, for a subtle transient hint. */
  lastIgnored: { reason: GateIgnoreReason; at: number } | null
  setActive: (active: boolean) => void
  setPhase: (phase: ContinuousPhase) => void
  setError: (error: string | null) => void
  setIgnored: (reason: GateIgnoreReason, at: number) => void
  reset: () => void
}

export const useContinuousVoiceStore = create<ContinuousVoiceState>((set) => ({
  active: false,
  phase: 'idle',
  error: null,
  lastIgnored: null,
  setActive: (active) => set({ active }),
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error }),
  setIgnored: (reason, at) => set({ lastIgnored: { reason, at } }),
  reset: () => set({ active: false, phase: 'idle', error: null, lastIgnored: null }),
}))
