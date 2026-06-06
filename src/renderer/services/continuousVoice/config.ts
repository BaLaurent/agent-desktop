/**
 * Single source of truth for continuous-voice settings → typed config.
 *
 * Reads the renderer settings store and applies the defaults documented in the plan. Centralizing
 * here keeps the defaults DRY across the engine, the gate wiring, and the settings UI.
 */

import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_VAD_CONFIG, type VadConfig } from './vadStateMachine'
import type { GateMode, VoiceGateConfig } from '../voiceGate'
import type { HotwordConfig, HotwordBackendPref } from '../hotword'

function settings(): Record<string, string> {
  return useSettingsStore.getState().settings
}

function num(key: string, fallback: number): number {
  const v = Number(settings()[key])
  return Number.isFinite(v) && settings()[key] !== '' ? v : fallback
}

export interface ContinuousVoiceFlags {
  enabled: boolean
  pauseDuringTts: boolean
}

export function readContinuousVoiceFlags(): ContinuousVoiceFlags {
  const s = settings()
  return {
    enabled: s['continuousVoice_enabled'] === 'true',
    // default ON (half-duplex anti-echo); only 'false' disables it
    pauseDuringTts: s['continuousVoice_pauseDuringTts'] !== 'false',
  }
}

export interface EngineConfig {
  vad: VadConfig
  /** Pre-roll (ms) prepended on speech onset so the first phoneme isn't clipped. */
  preSpeechPadMs: number
}

export function readEngineConfig(): EngineConfig {
  return {
    vad: {
      silenceThreshold: num('continuousVoice_silenceThreshold', DEFAULT_VAD_CONFIG.silenceThreshold),
      silenceDurationMs: num('continuousVoice_silenceDurationMs', DEFAULT_VAD_CONFIG.silenceDurationMs),
      minUtteranceMs: num('continuousVoice_minUtteranceMs', DEFAULT_VAD_CONFIG.minUtteranceMs),
      onsetBlocks: DEFAULT_VAD_CONFIG.onsetBlocks,
    },
    preSpeechPadMs: num('continuousVoice_preSpeechPadMs', 200),
  }
}

export function readHotwordConfig(): HotwordConfig {
  const s = settings()
  return {
    modelSource: s['hotword_modelSource'] === 'manual' ? 'manual' : 'bundled',
    model: s['hotword_model'] || 'hey_jarvis',
    modelPath: s['hotword_modelPath'] || undefined,
    threshold: num('hotword_threshold', 0.5),
    backend: (s['hotword_backend'] as HotwordBackendPref) || 'auto',
  }
}

export function readGateConfig(): VoiceGateConfig {
  const s = settings()
  const mode: GateMode = s['continuousVoice_gateMode'] === 'intent' ? 'intent' : 'wakeword'
  // The hotword model id doubles as the spoken phrase for cosmetic text-strip:
  // 'hey_jarvis' → 'hey jarvis', custom 'hey_clawd' → 'hey clawd'.
  const wakeword = (s['hotword_model'] || 'hey clawd').replace(/_/g, ' ')
  return {
    mode,
    wakeword,
    followupWindowMs: num('continuousVoice_followupWindowMs', 8000),
  }
}
