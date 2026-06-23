import { useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { CustomWakewordTrainer } from './CustomWakewordTrainer'
import { DEFAULT_INTENT_PROMPT, draftToStored } from '../../../core/services/voiceIntentPrompt'

const inputStyle = {
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)',
}

/** Common openWakeWord pretrained wake words (custom-trained ones are added via the trainer). */
const BUNDLED_WAKEWORDS = ['hey_jarvis', 'alexa', 'hey_mycroft', 'hey_rhasspy']

const INTENT_MODEL_PRESETS = [
  { label: 'Auto', value: '' },
  { label: 'Haiku', value: 'claude-haiku-4-5-20251001' },
  { label: 'Sonnet', value: 'claude-sonnet-4-6' },
  { label: 'Opus', value: 'claude-opus-4-8' },
]

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{label}</span>
        {hint && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</span>}
      </span>
    </label>
  )
}

function NumberRow({ label, value, onChange, min, max, step, hint }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</label>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-28 px-2 py-1 rounded text-sm outline-none"
          style={inputStyle}
          aria-label={label}
        />
      </div>
      {hint && <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</span>}
    </div>
  )
}

function SegButtons<T extends string>({ options, value, onChange, ariaLabel }: { options: readonly { label: string; value: T }[]; value: T; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div className="flex gap-2 flex-wrap" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: value === o.value ? 'var(--color-primary)' : 'var(--color-deep)',
            color: value === o.value ? 'var(--color-base)' : 'var(--color-text)',
          }}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function IntentPromptEditor({ stored, onPersist }: { stored: string; onPersist: (storedValue: string) => void }) {
  const [draft, setDraft] = useState(stored || DEFAULT_INTENT_PROMPT)

  const update = (value: string) => {
    setDraft(value)
    onPersist(draftToStored(value))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Intent prompt</label>
        {stored !== '' && (
          <button
            onClick={() => { setDraft(DEFAULT_INTENT_PROMPT); onPersist('') }}
            className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
          >
            Reset to default
          </button>
        )}
      </div>
      <textarea
        value={draft}
        onChange={(e) => update(e.target.value)}
        rows={8}
        className="w-full px-3 py-2 rounded text-sm outline-none resize-y font-mono"
        style={inputStyle}
        aria-label="Intent classification prompt"
      />
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Placeholders: {'{utterance}'} (the transcribed text) and {'{agent_name}'} (the assistant&apos;s name). Editing this only saves when it differs from the built-in default.
      </span>
    </div>
  )
}

export function ContinuousVoiceSettings() {
  const { settings, setSetting } = useSettingsStore()
  const [showAdvanced, setShowAdvanced] = useState(false)

  const enabled = settings['continuousVoice_enabled'] === 'true'
  const gateMode = settings['continuousVoice_gateMode'] === 'intent' ? 'intent' : 'wakeword'
  const modelSource = settings['hotword_modelSource'] === 'manual' ? 'manual' : 'bundled'
  const intentModel = settings['continuousVoice_intentModel'] || ''
  const isCustomIntentModel = intentModel !== '' && !INTENT_MODEL_PRESETS.some((p) => p.value === intentModel)

  const num = (key: string, fallback: number) => {
    const v = Number(settings[key])
    return Number.isFinite(v) && settings[key] !== '' ? v : fallback
  }

  return (
    <div className="flex flex-col gap-5 pt-4" style={{ borderTop: '1px solid var(--color-deep)' }}>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Continuous Voice (always-listening)</span>
        <Toggle
          checked={enabled}
          onChange={(v) => setSetting('continuousVoice_enabled', v ? 'true' : 'false')}
          label="Enable continuous voice mode"
          hint="The app keeps listening and decides when to send, via a wake word or intent detection. Uses the selected STT engine above for transcription."
        />
      </div>

      {enabled && (
        <>
          {/* Gate mode */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Gating mode</label>
            <SegButtons
              ariaLabel="Gating mode"
              value={gateMode}
              onChange={(v) => setSetting('continuousVoice_gateMode', v)}
              options={[{ label: 'Wake word', value: 'wakeword' }, { label: 'Intent detection', value: 'intent' }]}
            />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {gateMode === 'wakeword'
                ? 'Only responds after the wake word is detected (local, free, private).'
                : 'Runs a small AI check on each utterance to decide if you were talking to the assistant. Adds latency + cost per utterance.'}
            </span>
          </div>

          {gateMode === 'wakeword' && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Wake word model</label>
                <SegButtons
                  ariaLabel="Model source"
                  value={modelSource}
                  onChange={(v) => setSetting('hotword_modelSource', v)}
                  options={[{ label: 'Bundled', value: 'bundled' }, { label: 'Custom (trained)', value: 'manual' }]}
                />
                {modelSource === 'bundled' ? (
                  <select
                    value={settings['hotword_model'] || 'hey_jarvis'}
                    onChange={(e) => setSetting('hotword_model', e.target.value)}
                    className="w-full px-3 py-2 rounded text-sm outline-none"
                    style={inputStyle}
                    aria-label="Bundled wake word"
                  >
                    {BUNDLED_WAKEWORDS.map((w) => (
                      <option key={w} value={w}>{w.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={settings['hotword_modelPath'] || ''}
                    onChange={(e) => setSetting('hotword_modelPath', e.target.value)}
                    placeholder="/path/to/wakeword-model-folder"
                    className="w-full px-3 py-2 rounded text-sm outline-none"
                    style={inputStyle}
                    aria-label="Custom wake word model folder"
                  />
                )}
              </div>

              <NumberRow
                label="Detection sensitivity"
                value={num('hotword_threshold', 0.5)}
                onChange={(v) => setSetting('hotword_threshold', String(v))}
                min={0.1}
                max={0.95}
                step={0.05}
                hint="Higher = fewer false triggers but more misses (default 0.5)."
              />

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Execution provider</label>
                <SegButtons
                  ariaLabel="Hotword backend"
                  value={(settings['hotword_backend'] as 'auto' | 'webgpu' | 'wasm') || 'auto'}
                  onChange={(v) => setSetting('hotword_backend', v)}
                  options={[{ label: 'Auto', value: 'auto' }, { label: 'WebGPU', value: 'webgpu' }, { label: 'WASM', value: 'wasm' }]}
                />
              </div>

              <CustomWakewordTrainer />
            </>
          )}

          {gateMode === 'intent' && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Intent model</label>
                <SegButtons
                  ariaLabel="Intent model preset"
                  value={isCustomIntentModel ? '__custom__' : intentModel}
                  onChange={(v) => setSetting('continuousVoice_intentModel', v === '__custom__' ? intentModel || 'custom-model' : v)}
                  options={[...INTENT_MODEL_PRESETS, { label: 'Custom…', value: '__custom__' }]}
                />
                {isCustomIntentModel && (
                  <input
                    type="text"
                    value={intentModel}
                    onChange={(e) => setSetting('continuousVoice_intentModel', e.target.value)}
                    placeholder="provider/model-id"
                    className="w-full px-3 py-2 rounded text-sm outline-none"
                    style={inputStyle}
                    aria-label="Custom intent model"
                  />
                )}
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  &quot;Auto&quot; uses the conversation&apos;s model (falling back to Haiku). Cheapest/fastest is Haiku.
                </span>
              </div>

              <IntentPromptEditor
                stored={settings['continuousVoice_intentPrompt'] || ''}
                onPersist={(v) => setSetting('continuousVoice_intentPrompt', v)}
              />
            </>
          )}

          {/* Follow-up window */}
          <NumberRow
            label="Follow-up window (seconds)"
            value={Math.round(num('continuousVoice_followupWindowMs', 8000) / 1000)}
            onChange={(v) => setSetting('continuousVoice_followupWindowMs', String(Math.max(0, v) * 1000))}
            min={0}
            max={60}
            step={1}
            hint="After a reply, accept the next utterance with no wake word / no intent check for this long. 0 = off."
          />

          <Toggle
            checked={settings['continuousVoice_pauseDuringTts'] !== 'false'}
            onChange={(v) => setSetting('continuousVoice_pauseDuringTts', v ? 'true' : 'false')}
            label="Pause listening while the assistant speaks"
            hint="Half-duplex: avoids the assistant hearing its own text-to-speech (feedback loop). Recommended."
          />

          <Toggle
            checked={settings['continuousVoice_pauseDuringProcessing'] !== 'false'}
            onChange={(v) => setSetting('continuousVoice_pauseDuringProcessing', v ? 'true' : 'false')}
            label="Pause while processing your request"
            hint="Stops listening from the moment a request is detected until the assistant finishes replying, so chained sentences don't pile up."
          />

          {/* VAD advanced */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setShowAdvanced((s) => !s)}
              className="text-sm font-medium text-left hover:opacity-80"
              style={{ color: 'var(--color-primary)' }}
            >
              {showAdvanced ? '▾' : '▸'} Voice activity detection (advanced)
            </button>
            {showAdvanced && (
              <div className="flex flex-col gap-3 pl-3">
                <NumberRow label="Silence threshold (RMS)" value={num('continuousVoice_silenceThreshold', 0.012)} onChange={(v) => setSetting('continuousVoice_silenceThreshold', String(v))} min={0.001} max={0.2} step={0.001} hint="Below this level counts as silence (default 0.012)." />
                <NumberRow label="End-of-utterance silence (ms)" value={num('continuousVoice_silenceDurationMs', 900)} onChange={(v) => setSetting('continuousVoice_silenceDurationMs', String(v))} min={300} max={3000} step={50} />
                <NumberRow label="Minimum utterance (ms)" value={num('continuousVoice_minUtteranceMs', 400)} onChange={(v) => setSetting('continuousVoice_minUtteranceMs', String(v))} min={100} max={2000} step={50} hint="Shorter sounds (coughs/clicks) are ignored." />
                <NumberRow label="Pre-speech padding (ms)" value={num('continuousVoice_preSpeechPadMs', 200)} onChange={(v) => setSetting('continuousVoice_preSpeechPadMs', String(v))} min={0} max={500} step={50} hint="Audio kept before onset so the first word isn't clipped." />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
