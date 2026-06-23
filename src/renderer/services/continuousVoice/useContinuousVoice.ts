import { useCallback, useEffect, useRef } from 'react'
import { startContinuousVoiceEngine, type ContinuousVoiceEngine } from './engine'
import { readEngineConfig, readGateConfig, readHotwordConfig, readContinuousVoiceFlags } from './config'
import { useContinuousVoiceStore } from './continuousVoiceStore'
import { createVoiceGate, type VoiceGate } from '../voiceGate'
import { createHotword, type Hotword } from '../hotword'
import { useTtsStore } from '../../stores/ttsStore'

/**
 * Orchestrates a continuous-voice session — the shared seam used by BOTH surfaces (overlay + main
 * chat view). Acquires ONE mic stream, wires: VAD engine → gate (wake correlation / intent) → onSend,
 * the hotword detector (wakeword mode only) fed from the engine's frames, and half-duplex TTS
 * suspension. Clock contract honored: both VAD timestamps and `recordWake(performance.now())` are
 * stamped on the main thread with the same clock.
 */
export function useContinuousVoice(opts: {
  conversationId: number | null
  onSend: (text: string) => void
}) {
  const { conversationId, onSend } = opts
  const engineRef = useRef<ContinuousVoiceEngine | null>(null)
  const hotwordRef = useRef<Hotword | null>(null)
  const gateRef = useRef<VoiceGate | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const levelRef = useRef(0)
  // Bumped by stop()/unmount to invalidate an in-flight start() across its awaits.
  const startGenRef = useRef(0)
  const onSendRef = useRef(onSend)
  onSendRef.current = onSend

  const store = useContinuousVoiceStore
  const speakingMessageId = useTtsStore((s) => s.speakingMessageId)

  const stop = useCallback(() => {
    startGenRef.current++
    engineRef.current?.stop()
    hotwordRef.current?.stop()
    gateRef.current?.dispose()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    engineRef.current = null
    hotwordRef.current = null
    gateRef.current = null
    streamRef.current = null
    store.getState().reset()
  }, [store])

  const start = useCallback(async () => {
    if (engineRef.current) return
    const token = ++startGenRef.current
    try {
      // autoGainControl ON: openWakeWord (and the reference impl) rely on the browser's AGC to
      // normalize speech level/dynamics. (The hotword detector runs off the engine's frames
      // independently of the VAD; the VAD's fixed RMS threshold is tuned separately.)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      // Bail if stop()/unmount happened during the await — don't leak a live mic track.
      if (token !== startGenRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream

      const gate = createVoiceGate({
        getConfig: readGateConfig,
        classifyIntent: (text) =>
          conversationId
            ? window.agent.voiceIntent.classify(conversationId, text)
            : Promise.resolve({ addressed: false }),
      })
      gateRef.current = gate

      // Hotword detector only matters in wakeword mode.
      if (readGateConfig().mode === 'wakeword') {
        const hw = await createHotword(readHotwordConfig(), () =>
          gateRef.current?.recordWake(performance.now()),
        )
        if (token !== startGenRef.current) {
          hw.stop()
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        hotwordRef.current = hw
      }

      engineRef.current = startContinuousVoiceEngine(stream, readEngineConfig(), {
        onUtterance: async (u) => {
          store.getState().setProcessing('classifying')
          if (readContinuousVoiceFlags().pauseDuringProcessing) engineRef.current?.suspend()
          const decision = await gate.evaluate(u)
          if (decision.action === 'send') {
            store.getState().setProcessing('replying')
            onSendRef.current(decision.text)
          } else {
            store.getState().setProcessing(null)
            if (readContinuousVoiceFlags().pauseDuringProcessing) engineRef.current?.resume()
            store.getState().setIgnored(decision.reason, performance.now())
          }
        },
        onPhaseChange: (p) => store.getState().setPhase(p),
        onLevel: (rms) => {
          levelRef.current = rms
        },
        onFrame: (pcm, sr) => hotwordRef.current?.feed(pcm, sr),
        onError: (msg) => store.getState().setError(msg),
      })
      store.getState().setActive(true)
    } catch (err) {
      stop()
      const msg = err instanceof Error ? err.message : 'Failed to start continuous voice'
      store.getState().setError(
        msg.includes('NotAllowed') || msg.includes('Permission')
          ? 'Microphone access denied. Allow microphone access in your system settings.'
          : msg,
      )
    }
  }, [conversationId, store, stop])

  /** Call when an AI exchange finishes — opens the follow-up window, ends the processing state. */
  const notifyExchangeComplete = useCallback(() => {
    gateRef.current?.notifyExchangeComplete()
    store.getState().setProcessing(null)
    if (readContinuousVoiceFlags().pauseDuringProcessing) engineRef.current?.resume()
  }, [store])

  // Half-duplex: pause listening (and thus the hotword feed) while the assistant speaks.
  useEffect(() => {
    if (!engineRef.current) return
    if (!readContinuousVoiceFlags().pauseDuringTts) return
    if (speakingMessageId !== null) engineRef.current.suspend()
    else engineRef.current.resume()
  }, [speakingMessageId])

  // Cleanup on unmount.
  useEffect(() => stop, [stop])

  return { start, stop, notifyExchangeComplete, levelRef }
}
