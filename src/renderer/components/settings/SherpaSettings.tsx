import { useState, useCallback, useEffect } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { SHERPA_MODEL_PRESETS, BOOST_SCORE_MIN, BOOST_SCORE_MAX } from '../../../core/services/sherpaPresets'

const inputStyle = {
  backgroundColor: 'var(--color-base)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)',
}

type SourceMode = 'preset' | 'manual'

/**
 * Settings panel for the sherpa-onnx STT backend. Supports downloading a preset model or
 * pointing to a manually extracted folder. Architecture is auto-detected via validateConfig.
 */
export function SherpaSettings() {
  const { settings, setSetting } = useSettingsStore()
  const modelPath = settings.sherpa_modelPath || ''
  const sensitivity = settings.sherpa_hotwordsSensitivity || 'normal'
  const scoreOverride = settings.sherpa_hotwordsScoreOverride || ''
  const [mode, setMode] = useState<SourceMode>('preset')
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<{ index: number; total: number; file: string } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<{
    detected: string | null
    files: string[]
    ok: boolean
    detail?: string
  } | null>(null)
  const [installed, setInstalled] = useState<Map<string, string>>(new Map())

  const refreshInstalled = useCallback(() => {
    window.agent.sherpa
      .listInstalledModels()
      .then((list) => setInstalled(new Map(list.map(({ id, dir }) => [id, dir]))))
      .catch(() => {})
  }, [])
  useEffect(() => {
    refreshInstalled()
    const off = window.agent.sherpa.onDownloadProgress((p: { index: number; total: number; file: string }) =>
      setProgress(p)
    )
    return off
  }, [refreshInstalled])

  const handleBrowse = useCallback(async () => {
    const dir = await window.agent.system.selectFolder()
    if (dir) setSetting('sherpa_modelPath', dir)
  }, [setSetting])

  const handleDownload = useCallback(
    async (presetId: string) => {
      setError(null)
      setStatus(null)
      setDownloading(true)
      setProgress(null)
      try {
        const { modelPath: dir } = await window.agent.sherpa.downloadModel(presetId)
        setSetting('sherpa_modelPath', dir)
        setStatus(`Model ready at ${dir}`)
        refreshInstalled()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setDownloading(false)
        setProgress(null)
      }
    },
    [setSetting, refreshInstalled]
  )

  const handleUse = useCallback(
    (dir: string) => {
      setSetting('sherpa_modelPath', dir)
      setStatus(`Active: ${dir}`)
    },
    [setSetting]
  )

  const handleTest = useCallback(async () => {
    setError(null)
    setValidation(null)
    setValidation(await window.agent.sherpa.validateConfig())
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        sherpa-onnx runs ONNX speech models locally via a native addon (no browser/WASM).
        Download a preset or point to a model folder — the architecture is auto-detected.
        Requires <code>npm install sherpa-onnx-node</code>.
      </p>

      {/* Source mode toggle */}
      <div className="flex gap-2">
        {(['preset', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className="px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              backgroundColor: mode === m ? 'var(--color-primary)' : 'var(--color-deep)',
              color: mode === m ? 'var(--color-base)' : 'var(--color-text)',
            }}
          >
            {m === 'preset' ? 'Download preset' : 'Manual folder'}
          </button>
        ))}
      </div>

      {/* Preset list */}
      {mode === 'preset' && (
        <div className="flex flex-col gap-3">
          {SHERPA_MODEL_PRESETS.map((p) => {
            const presetDir = installed.get(p.id)
            const isInstalled = presetDir !== undefined
            const isActive = modelPath === presetDir
            return (
              <div
                key={p.id}
                className="flex flex-col gap-1.5 p-3 rounded"
                style={{ backgroundColor: 'var(--color-deep)' }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {p.label}
                  </span>
                  {isInstalled && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--color-success, var(--color-primary))', color: 'var(--color-base)', opacity: 0.85 }}
                    >
                      Installed
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {p.description}
                </span>
                <div className="flex gap-2">
                  {isInstalled && (
                    <button
                      onClick={() => handleUse(presetDir)}
                      disabled={isActive}
                      className="self-start px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                      style={{ backgroundColor: 'var(--color-success, var(--color-primary))', color: 'var(--color-base)' }}
                    >
                      {isActive ? 'Active' : 'Use'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDownload(p.id)}
                    disabled={downloading}
                    className="self-start px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ backgroundColor: isInstalled ? 'var(--color-deep)' : 'var(--color-primary)', color: isInstalled ? 'var(--color-text-muted)' : 'var(--color-base)', border: isInstalled ? '1px solid var(--color-text-muted)' : 'none' }}
                  >
                    {downloading ? 'Downloading…' : isInstalled ? 'Re-download' : 'Download'}
                  </button>
                </div>
              </div>
            )
          })}
          {progress && (
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {progress.index + 1}/{progress.total} · {progress.file}
            </span>
          )}
        </div>
      )}

      {/* Manual folder */}
      {mode === 'manual' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Model Folder
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelPath}
              onChange={(e) => setSetting('sherpa_modelPath', e.target.value)}
              placeholder="~/.agent-desktop/stt-models/..."
              className="flex-1 px-3 py-2 rounded text-sm outline-none"
              style={inputStyle}
              aria-label="Sherpa model folder"
            />
            <button
              onClick={handleBrowse}
              className="px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
            >
              Browse
            </button>
          </div>
        </div>
      )}

      {/* Test / validate */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleTest}
          className="self-start px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
        >
          Test Configuration
        </button>
        {validation && (
          <div className="text-xs flex flex-col gap-0.5" style={{ color: 'var(--color-text-muted)' }}>
            <span>Detected architecture: {validation.detected ?? '—'}</span>
            <span>Files: {validation.files.join(', ') || '(none)'}</span>
            {!validation.ok && validation.detail && <span>Detail: {validation.detail}</span>}
          </div>
        )}
      </div>

      {status && (
        <span className="text-xs" style={{ color: 'var(--color-success, var(--color-primary))' }}>
          {status}
        </span>
      )}
      {error && (
        <span className="text-xs" style={{ color: 'var(--color-danger, #e06c75)' }}>
          {error}
        </span>
      )}

      {/* Hotwords boost strength (custom-word lexicon → contextual biasing) */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Lexicon boost strength
        </label>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          How strongly lexicon words are favored. Too strong makes them appear when not spoken.
        </span>
        <div className="flex gap-2">
          {(['soft', 'normal', 'strong'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSetting('sherpa_hotwordsSensitivity', s)}
              aria-pressed={sensitivity === s}
              className="px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
              style={{
                backgroundColor: sensitivity === s ? 'var(--color-primary)' : 'var(--color-deep)',
                color: sensitivity === s ? 'var(--color-base)' : 'var(--color-text)',
              }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <details>
          <summary className="text-xs cursor-pointer" style={{ color: 'var(--color-text-muted)' }}>
            Advanced: custom Boost score
          </summary>
          <div className="flex flex-col gap-1 mt-2">
            <input
              type="number"
              step="0.5"
              min={BOOST_SCORE_MIN}
              max={BOOST_SCORE_MAX}
              value={scoreOverride}
              onChange={(e) => setSetting('sherpa_hotwordsScoreOverride', e.target.value)}
              placeholder="(use preset)"
              className="w-32 px-3 py-1.5 rounded text-sm outline-none"
              style={inputStyle}
              aria-label="Custom Boost score"
            />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Overrides the preset above. Leave empty to use the buttons. Accepted {BOOST_SCORE_MIN}–
              {BOOST_SCORE_MAX} (out-of-range values are clamped); typical 1.5–6.
            </span>
          </div>
        </details>
      </div>
    </div>
  )
}
