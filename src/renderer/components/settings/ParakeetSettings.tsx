import { useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  loadParakeet,
  selftestParakeet,
  resetParakeet,
  type ParakeetBackendPref,
  type ParakeetDecoderQuant,
  type ParakeetSelftestResult,
} from '../../services/parakeet'

const inputStyle = {
  backgroundColor: 'var(--color-base)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)',
}

const BACKENDS: { id: ParakeetBackendPref; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'webgpu', label: 'WebGPU' },
  { id: 'wasm', label: 'WASM (CPU)' },
]

function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className="px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
          style={{
            backgroundColor: value === o.id ? 'var(--color-primary)' : 'var(--color-deep)',
            color: value === o.id ? 'var(--color-base)' : 'var(--color-text)',
          }}
          aria-pressed={value === o.id}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Settings panel for the Parakeet (ONNX/WASM) STT engine. The model and onnxruntime-web
 * run in a renderer Web Worker (see services/parakeet); this panel drives acquisition
 * (download vs manual folder), execution provider, and a model-free runtime self-test.
 */
export function ParakeetSettings() {
  const { settings, setSetting } = useSettingsStore()
  const source = settings.parakeet_modelSource === 'manual' ? 'manual' : 'download'
  const backend = (settings.parakeet_backend as ParakeetBackendPref) || 'wasm'
  const modelPath = settings.parakeet_modelPath || ''
  const decoderQuant: ParakeetDecoderQuant = settings.parakeet_decoderQuant === 'fp32' ? 'fp32' : 'int8'
  const cpuThreadsRaw = settings.parakeet_cpuThreads || ''
  const chunkLengthRaw = settings.parakeet_chunkLengthS || ''
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Decoder precision and thread count are baked into the loaded ORT session — changing
  // them must tear down the worker so the next transcription reloads with the new config.
  const setLoadTimeSetting = useCallback((key: string, value: string) => {
    setSetting(key, value)
    resetParakeet()
  }, [setSetting])

  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ pct: number; file: string } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selftest, setSelftest] = useState<ParakeetSelftestResult | null>(null)

  const handleLoad = useCallback(async () => {
    setError(null)
    setStatus(null)
    setLoading(true)
    setProgress({ pct: 0, file: '' })
    try {
      await loadParakeet({ source, backend, decoderQuant, cpuThreads: Number(cpuThreadsRaw) || undefined }, (p) => {
        setProgress({ pct: p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0, file: p.file })
      })
      setStatus('Model ready — voice input will use Parakeet.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }, [source, backend, decoderQuant, cpuThreadsRaw])

  const handleBrowse = useCallback(async () => {
    const dir = await window.agent.system.selectFolder()
    if (dir) setSetting('parakeet_modelPath', dir)
  }, [setSetting])

  const handleSelftest = useCallback(async () => {
    setError(null)
    setSelftest(null)
    setSelftest(await selftestParakeet(backend))
  }, [backend])

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Parakeet TDT 0.6B v3 is NVIDIA's multilingual speech-to-text model (25 European
        languages, including French), run locally in your browser via ONNX Runtime Web —
        no external binary to install. The model is ~600 MB and is downloaded once, then
        cached on disk.
      </p>

      {/* Execution provider */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Execution Provider
        </label>
        <Segmented value={backend} options={BACKENDS} onChange={(v) => setSetting('parakeet_backend', v)} />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          WASM (CPU) downloads the int8 model (~600 MB) and runs everywhere. WebGPU is faster but
          requires an fp32 encoder (multi-GB download &amp; VRAM) and isn't available in every
          environment. Auto picks WebGPU when present, otherwise WASM.
        </span>
      </div>

      {/* Model source */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Model Source
        </label>
        <Segmented
          value={source}
          options={[{ id: 'download', label: 'Download' }, { id: 'manual', label: 'Manual folder' }]}
          onChange={(v) => setSetting('parakeet_modelSource', v)}
        />
      </div>

      {source === 'manual' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Model Folder
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelPath}
              onChange={(e) => setSetting('parakeet_modelPath', e.target.value)}
              placeholder="/path/to/parakeet-tdt-0.6b-v3-onnx"
              className="flex-1 px-3 py-2 rounded text-sm outline-none"
              style={inputStyle}
              aria-label="Parakeet model folder"
            />
            <button
              onClick={handleBrowse}
              className="px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
            >
              Browse
            </button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Folder containing encoder-model(.int8).onnx, decoder_joint-model.int8.onnx and vocab.txt.
          </span>
        </div>
      )}

      {/* Load / prepare model */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleLoad}
          disabled={loading}
          className="px-3 py-2 rounded text-sm font-medium self-start transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-base)' }}
        >
          {loading
            ? 'Preparing…'
            : source === 'download'
              ? 'Download & prepare model'
              : 'Load model'}
        </button>

        {progress && (
          <div className="flex flex-col gap-1">
            <div className="h-2 rounded overflow-hidden" style={{ backgroundColor: 'var(--color-deep)' }}>
              <div className="h-full" style={{ width: `${progress.pct}%`, backgroundColor: 'var(--color-primary)' }} />
            </div>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {progress.pct}% {progress.file && `· ${progress.file}`}
            </span>
          </div>
        )}

        {status && (
          <span className="text-xs" style={{ color: 'var(--color-success, var(--color-primary))' }}>{status}</span>
        )}
        {error && (
          <span className="text-xs" style={{ color: 'var(--color-danger, #e06c75)' }}>{error}</span>
        )}
      </div>

      {/* Advanced parameters */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 self-start text-sm font-medium transition-opacity hover:opacity-80"
          style={{ color: 'var(--color-text)' }}
          aria-expanded={showAdvanced}
        >
          <span className="inline-block transition-transform text-xs" style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            &#9654;
          </span>
          Advanced Parameters
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-5 pl-4 pt-2" style={{ borderLeft: '2px solid var(--color-deep)' }}>
            {/* Decoder precision (load-time → reloads the model) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Decoder Precision</label>
              <Segmented
                value={decoderQuant}
                options={[{ id: 'int8' as const, label: 'int8 (lighter)' }, { id: 'fp32' as const, label: 'fp32 (accurate)' }]}
                onChange={(v) => setLoadTimeSetting('parakeet_decoderQuant', v)}
              />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                fp32 is more accurate but downloads a larger decoder and runs slower. Changing this reloads the model.
              </span>
            </div>

            {/* WASM threads (load-time → reloads the model) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>CPU Threads (WASM)</label>
              <input
                type="number"
                min={0}
                value={cpuThreadsRaw}
                onChange={(e) => setLoadTimeSetting('parakeet_cpuThreads', e.target.value)}
                placeholder="auto"
                className="w-28 px-3 py-2 rounded text-sm outline-none"
                style={inputStyle}
                aria-label="Parakeet CPU threads"
              />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                WASM/CPU thread count (needs SharedArrayBuffer). Empty = auto. Changing this reloads the model.
              </span>
            </div>

            {/* Long-audio chunking (transcribe-time → no reload) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Long-audio Window (s)</label>
              <input
                type="number"
                min={0}
                value={chunkLengthRaw}
                onChange={(e) => setSetting('parakeet_chunkLengthS', e.target.value)}
                placeholder="auto"
                className="w-28 px-3 py-2 rounded text-sm outline-none"
                style={inputStyle}
                aria-label="Parakeet long-audio window seconds"
              />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Window length for long recordings (transcribeLongAudio). Empty/0 = automatic windowing.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Runtime self-test (no download) */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleSelftest}
          className="px-3 py-2 rounded text-sm font-medium self-start transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
        >
          Test ONNX runtime
        </button>
        {selftest && (
          <div className="text-xs flex flex-col gap-0.5" style={{ color: 'var(--color-text-muted)' }}>
            <span>WASM runtime: {selftest.ortLoaded ? '✓ loaded' : '✗ failed'}</span>
            <span>WebGPU adapter: {selftest.webgpu ? '✓ available' : '— not available (will use WASM/CPU)'}</span>
            <span>Resolved backend: {selftest.backend}</span>
            {!selftest.ortLoaded && selftest.detail && <span>Detail: {selftest.detail}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
