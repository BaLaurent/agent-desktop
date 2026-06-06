import { useState, useCallback, useEffect } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { SHERPA_MODEL_PRESETS } from '../../../core/services/sherpaPresets'

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

  useEffect(() => {
    const off = window.agent.sherpa.onDownloadProgress((p: { index: number; total: number; file: string }) =>
      setProgress(p)
    )
    return off
  }, [])

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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setDownloading(false)
        setProgress(null)
      }
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
        Requires <code>npm install sherpa-onnx</code>.
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
          {SHERPA_MODEL_PRESETS.map((p) => (
            <div
              key={p.id}
              className="flex flex-col gap-1.5 p-3 rounded"
              style={{ backgroundColor: 'var(--color-deep)' }}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                {p.label}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {p.description}
              </span>
              <button
                onClick={() => handleDownload(p.id)}
                disabled={downloading}
                className="self-start px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-base)' }}
              >
                {downloading ? 'Downloading…' : 'Download'}
              </button>
            </div>
          ))}
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
    </div>
  )
}
