import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'

interface ValidationResult {
  binaryFound: boolean
  modelFound: boolean
  binaryPath: string
  modelPath: string
}

interface WhisperAdvancedParams {
  language: string
  translate: boolean
  prompt: string
  threads: number
  noGpu: boolean
  flashAttn: boolean
  temperature: number
  bestOf: number
  beamSize: number
  noSpeechThreshold: number
  noFallback: boolean
  vad: boolean
  vadModel: string
  vadThreshold: number
}

const ADVANCED_DEFAULTS: WhisperAdvancedParams = {
  language: 'en',
  translate: false,
  prompt: '',
  threads: 4,
  noGpu: false,
  flashAttn: true,
  temperature: 0,
  bestOf: 5,
  beamSize: 5,
  noSpeechThreshold: 0.6,
  noFallback: false,
  vad: false,
  vadModel: '',
  vadThreshold: 0.5,
}

const inputStyle = {
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)',
}

function NumberRow({ label, value, onChange, hint, ...rest }: {
  label: string
  value: number
  onChange: (v: number) => void
  hint?: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-3">
        <label className="text-sm w-44 shrink-0" style={{ color: 'var(--color-text)' }}>{label}</label>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 px-2 py-1.5 rounded text-sm outline-none"
          style={inputStyle}
          aria-label={label}
          {...rest}
        />
      </div>
      {hint && <span className="text-xs pl-[11.75rem]" style={{ color: 'var(--color-text-muted)' }}>{hint}</span>}
    </div>
  )
}

function CheckRow({ label, checked, onChange, hint }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-[var(--color-primary)]"
        />
        {label}
      </label>
      {hint && <span className="text-xs pl-6" style={{ color: 'var(--color-text-muted)' }}>{hint}</span>}
    </div>
  )
}

function SectionHeader({ children }: { children: string }) {
  return (
    <h4
      className="text-xs font-semibold uppercase tracking-wide pt-1"
      style={{ color: 'var(--color-text-muted)' }}
    >
      {children}
    </h4>
  )
}

export function VoiceInputSettings() {
  const { settings, setSetting } = useSettingsStore()
  const [binaryPath, setBinaryPath] = useState(settings.whisper_binaryPath || 'whisper-cli')
  const [modelPath, setModelPath] = useState(settings.whisper_modelPath || '')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advanced, setAdvanced] = useState<WhisperAdvancedParams>(ADVANCED_DEFAULTS)

  // Sync from store when settings load
  useEffect(() => {
    setBinaryPath(settings.whisper_binaryPath || 'whisper-cli')
    setModelPath(settings.whisper_modelPath || '')
  }, [settings.whisper_binaryPath, settings.whisper_modelPath])

  // Load advanced params from settings
  useEffect(() => {
    const raw = settings.whisper_advancedParams
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        setAdvanced({ ...ADVANCED_DEFAULTS, ...parsed })
      } catch {
        setAdvanced(ADVANCED_DEFAULTS)
      }
    } else {
      setAdvanced(ADVANCED_DEFAULTS)
    }
  }, [settings.whisper_advancedParams])

  const saveBinaryPath = useCallback((value: string) => {
    setBinaryPath(value)
    setSetting('whisper_binaryPath', value)
    setValidation(null)
  }, [setSetting])

  const saveModelPath = useCallback((value: string) => {
    setModelPath(value)
    setSetting('whisper_modelPath', value)
    setValidation(null)
  }, [setSetting])

  const handleBrowseModel = useCallback(async () => {
    const selected = await window.agent.system.selectFile()
    if (selected) {
      saveModelPath(selected)
    }
  }, [saveModelPath])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setValidation(null)
    try {
      const result = await window.agent.whisper.validateConfig()
      setValidation(result)
    } catch {
      setValidation(null)
    } finally {
      setTesting(false)
    }
  }, [])

  const updateParam = (key: keyof WhisperAdvancedParams, value: string | number | boolean) => {
    setAdvanced(prev => {
      const updated = { ...prev, [key]: value }
      // Only persist non-default values
      const sparse: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(updated)) {
        if (v !== ADVANCED_DEFAULTS[k as keyof WhisperAdvancedParams]) {
          sparse[k] = v
        }
      }
      setSetting('whisper_advancedParams', Object.keys(sparse).length > 0 ? JSON.stringify(sparse) : '')
      return updated
    })
  }

  const handleBrowseVadModel = useCallback(async () => {
    const selected = await window.agent.system.selectFile()
    if (selected) {
      updateParam('vadModel', selected)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-6">
      {/* Info */}
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Voice input uses{' '}
        <span className="font-medium" style={{ color: 'var(--color-text)' }}>whisper.cpp</span>
        {' '}for local speech-to-text transcription. Install it from{' '}
        <button
          onClick={() => window.agent.system.openExternal('https://github.com/ggerganov/whisper.cpp')}
          className="underline hover:opacity-80"
          style={{ color: 'var(--color-primary)' }}
        >
          github.com/ggerganov/whisper.cpp
        </button>
        {' '}and download a model file (e.g. ggml-base.en.bin).
      </p>

      {/* Binary path */}
      <div className="flex flex-col gap-1.5">
        <label
          className="text-sm font-medium"
          style={{ color: 'var(--color-text)' }}
        >
          Whisper Binary Path
        </label>
        <input
          type="text"
          value={binaryPath}
          onChange={(e) => saveBinaryPath(e.target.value)}
          placeholder="whisper-cli"
          className="w-full px-3 py-2 rounded text-sm outline-none"
          style={inputStyle}
          aria-label="Whisper binary path"
        />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Full path or command name if it's in your PATH (e.g. whisper-cli, /usr/local/bin/whisper-cli)
        </span>
      </div>

      {/* Model path */}
      <div className="flex flex-col gap-1.5">
        <label
          className="text-sm font-medium"
          style={{ color: 'var(--color-text)' }}
        >
          Whisper Model Path
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={modelPath}
            onChange={(e) => saveModelPath(e.target.value)}
            placeholder="/path/to/ggml-base.en.bin"
            className="flex-1 px-3 py-2 rounded text-sm outline-none"
            style={inputStyle}
            aria-label="Whisper model path"
          />
          <button
            onClick={handleBrowseModel}
            className="px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: 'var(--color-deep)',
              color: 'var(--color-text)',
            }}
          >
            Browse
          </button>
        </div>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Path to a GGML model file (e.g. ggml-base.en.bin, ggml-small.bin)
        </span>
      </div>

      {/* Test button + results */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="self-start px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 bg-tool text-contrast"
          style={{ opacity: testing ? 0.6 : 1 }}
        >
          {testing ? 'Testing...' : 'Test Configuration'}
        </button>

        {validation && (
          <div
            className="flex flex-col gap-1.5 px-3 py-2 rounded text-sm"
            style={{
              backgroundColor: 'var(--color-bg)',
              border: `1px solid ${validation.binaryFound && validation.modelFound ? 'var(--color-success)' : 'var(--color-error)'}`,
            }}
          >
            <div className="flex items-center gap-2">
              <span>{validation.binaryFound ? '\u2713' : '\u2717'}</span>
              <span style={{ color: validation.binaryFound ? 'var(--color-success)' : 'var(--color-error)' }}>
                Binary: {validation.binaryPath}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span>{validation.modelFound ? '\u2713' : '\u2717'}</span>
              <span style={{ color: validation.modelFound ? 'var(--color-success)' : 'var(--color-error)' }}>
                Model: {validation.modelPath || '(not set)'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Auto-send */}
      <CheckRow
        label="Auto-send after transcription"
        checked={settings.whisper_autoSend === 'true'}
        onChange={(v) => setSetting('whisper_autoSend', v ? 'true' : 'false')}
        hint="Send the transcribed text as a message immediately instead of pasting it into the input"
      />

      {/* Advanced Parameters */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 self-start text-sm font-medium transition-opacity hover:opacity-80"
          style={{ color: 'var(--color-text)' }}
          aria-expanded={showAdvanced}
          aria-label="Toggle advanced parameters"
        >
          <span
            className="inline-block transition-transform text-xs"
            style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            &#9654;
          </span>
          Advanced Parameters
        </button>

        {showAdvanced && (
          <div
            className="flex flex-col gap-5 pl-4 pt-2"
            style={{ borderLeft: '2px solid var(--color-deep)' }}
          >
            {/* General */}
            <div className="flex flex-col gap-3">
              <SectionHeader>General</SectionHeader>

              <div className="flex flex-col gap-1">
                <label className="text-sm" style={{ color: 'var(--color-text)' }}>Language</label>
                <input
                  type="text"
                  value={advanced.language}
                  onChange={(e) => updateParam('language', e.target.value)}
                  placeholder="en"
                  className="w-32 px-3 py-1.5 rounded text-sm outline-none"
                  style={inputStyle}
                  aria-label="Whisper language"
                />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Language code (en, fr, de, es, ja, zh, ...) or &quot;auto&quot; for auto-detect
                </span>
              </div>

              <CheckRow
                label="Translate to English"
                checked={advanced.translate}
                onChange={(v) => updateParam('translate', v)}
                hint="Translate from source language to English"
              />

              <div className="flex flex-col gap-1">
                <label className="text-sm" style={{ color: 'var(--color-text)' }}>Initial Prompt</label>
                <input
                  type="text"
                  value={advanced.prompt}
                  onChange={(e) => updateParam('prompt', e.target.value)}
                  placeholder=""
                  className="w-full px-3 py-1.5 rounded text-sm outline-none"
                  style={inputStyle}
                  aria-label="Initial prompt"
                />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Helps with domain-specific vocabulary and context
                </span>
              </div>
            </div>

            {/* Performance */}
            <div className="flex flex-col gap-3">
              <SectionHeader>Performance</SectionHeader>

              <NumberRow
                label="Threads"
                value={advanced.threads}
                onChange={(v) => updateParam('threads', v)}
                min={1}
                max={64}
                step={1}
                hint="Number of CPU threads (default: 4)"
              />

              <CheckRow
                label="Disable GPU"
                checked={advanced.noGpu}
                onChange={(v) => updateParam('noGpu', v)}
                hint="Force CPU-only inference"
              />

              <CheckRow
                label="Flash Attention"
                checked={advanced.flashAttn}
                onChange={(v) => updateParam('flashAttn', v)}
                hint="Faster inference on supported hardware (default: on)"
              />
            </div>

            {/* Decoding */}
            <div className="flex flex-col gap-3">
              <SectionHeader>Decoding</SectionHeader>

              <NumberRow
                label="Temperature"
                value={advanced.temperature}
                onChange={(v) => updateParam('temperature', v)}
                min={0}
                max={1}
                step={0.05}
                hint="Sampling temperature, 0 = deterministic (default: 0)"
              />

              <NumberRow
                label="Best Of"
                value={advanced.bestOf}
                onChange={(v) => updateParam('bestOf', v)}
                min={1}
                max={100}
                step={1}
                hint="Number of best candidates to keep (default: 5)"
              />

              <NumberRow
                label="Beam Size"
                value={advanced.beamSize}
                onChange={(v) => updateParam('beamSize', v)}
                min={1}
                max={100}
                step={1}
                hint="Beam size for beam search (default: 5)"
              />

              <NumberRow
                label="No Speech Threshold"
                value={advanced.noSpeechThreshold}
                onChange={(v) => updateParam('noSpeechThreshold', v)}
                min={0}
                max={1}
                step={0.05}
                hint="Probability threshold for detecting silence (default: 0.6)"
              />

              <CheckRow
                label="Disable temperature fallback"
                checked={advanced.noFallback}
                onChange={(v) => updateParam('noFallback', v)}
                hint="Do not retry with higher temperature on decoder failure"
              />
            </div>

            {/* VAD */}
            <div className="flex flex-col gap-3">
              <SectionHeader>Voice Activity Detection</SectionHeader>

              <CheckRow
                label="Enable VAD"
                checked={advanced.vad}
                onChange={(v) => updateParam('vad', v)}
                hint="Pre-filter audio to detect speech segments before transcription"
              />

              {advanced.vad && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm" style={{ color: 'var(--color-text)' }}>VAD Model</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={advanced.vadModel}
                        onChange={(e) => updateParam('vadModel', e.target.value)}
                        placeholder="/path/to/silero-vad.onnx"
                        className="flex-1 px-3 py-1.5 rounded text-sm outline-none"
                        style={inputStyle}
                        aria-label="VAD model path"
                      />
                      <button
                        onClick={handleBrowseVadModel}
                        className="px-3 py-1.5 rounded text-sm font-medium transition-opacity hover:opacity-80"
                        style={{
                          backgroundColor: 'var(--color-deep)',
                          color: 'var(--color-text)',
                        }}
                      >
                        Browse
                      </button>
                    </div>
                  </div>

                  <NumberRow
                    label="VAD Threshold"
                    value={advanced.vadThreshold}
                    onChange={(v) => updateParam('vadThreshold', v)}
                    min={0}
                    max={1}
                    step={0.05}
                    hint="Speech detection sensitivity (default: 0.5)"
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
