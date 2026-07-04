import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import type { HotwordTrainEvent } from '../../../shared/agent-api'

const inputStyle = {
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)',
}

/**
 * Drives the openWakeWord custom-training sidecar (window.agent.hotwordTrain).
 * Lets the user install the one-time training toolchain, train a "hey clawd"-style model from a typed
 * phrase, watch streamed progress, and pick a trained model as the active wake word.
 */
export function CustomWakewordTrainer() {
  const { setSetting } = useSettingsStore()
  const [phrase, setPhrase] = useState('')
  const [running, setRunning] = useState(false)
  const [pct, setPct] = useState<number | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const [models, setModels] = useState<{ slug: string; path: string }[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const refreshModels = () => {
    window.agent.hotwordTrain.listModels().then(setModels).catch(() => {})
  }

  useEffect(() => {
    refreshModels()
    const unsub = window.agent.hotwordTrain.onEvent((ev: HotwordTrainEvent) => {
      if (ev.kind === 'progress') {
        setPct(ev.pct)
        setLogLines((l) => [...l.slice(-120), ev.message])
      } else if (ev.kind === 'log') {
        setLogLines((l) => [...l.slice(-120), ev.message])
      } else if (ev.kind === 'setup-done') {
        setRunning(false)
        setPct(null)
        setLogLines((l) => [...l, '✓ Training tools installed.'])
      } else if (ev.kind === 'done') {
        setRunning(false)
        setPct(null)
        setLogLines((l) => [...l, `✓ Trained "${ev.slug}".`])
        refreshModels()
        useModel(ev.slug, ev.modelPath)
      } else if (ev.kind === 'error') {
        setRunning(false)
        setPct(null)
        setLogLines((l) => [...l, `✗ ${ev.message}`])
      }
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logLines])

  /** Point the hotword engine at a trained model (managed models dir → manual source). */
  const useModel = (slug: string, modelPath: string) => {
    const dir = modelPath.replace(/[/\\][^/\\]+$/, '')
    setSetting('hotword_modelSource', 'manual')
    setSetting('hotword_modelPath', dir)
    setSetting('hotword_model', slug)
  }

  const train = () => {
    if (!phrase.trim()) return
    setRunning(true)
    setPct(0)
    setLogLines([`Training "${phrase.trim()}"…`])
    window.agent.hotwordTrain.start(phrase.trim()).catch((e) => {
      setRunning(false)
      setLogLines((l) => [...l, `✗ ${e?.message || 'Failed to start'}`])
    })
  }

  const install = () => {
    setRunning(true)
    setPct(0)
    setLogLines(['Installing training tools (this can take several minutes and ~hundreds of MB)…'])
    window.agent.hotwordTrain.setup().catch((e) => {
      setRunning(false)
      setLogLines((l) => [...l, `✗ ${e?.message || 'Failed to start setup'}`])
    })
  }

  const cancel = () => {
    window.agent.hotwordTrain.cancel().catch(() => {})
    setRunning(false)
    setPct(null)
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded" style={{ backgroundColor: 'var(--color-deep)' }}>
      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Train a custom wake word</span>
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Type a phrase (e.g. &quot;hey clawd&quot;). The app synthesizes training samples and trains a small local
        model — no recording needed. Requires the one-time training tools (Python/torch, Linux).
      </span>

      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="text"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="hey clawd"
          disabled={running}
          className="flex-1 min-w-[140px] px-3 py-2 rounded text-sm outline-none"
          style={inputStyle}
          aria-label="Wake word phrase"
        />
        {running ? (
          <button onClick={cancel} className="px-3 py-2 rounded text-sm font-medium" style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)', border: '1px solid var(--color-text-muted)' }}>
            Cancel
          </button>
        ) : (
          <>
            <button onClick={train} disabled={!phrase.trim()} className="px-3 py-2 rounded text-sm font-medium disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-base)' }}>
              Train
            </button>
            <button onClick={install} className="px-3 py-2 rounded text-sm" style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)', border: '1px solid var(--color-text-muted)' }}>
              Install tools
            </button>
          </>
        )}
      </div>

      {pct !== null && (
        <div className="h-1.5 rounded overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
          <div className="h-full transition-all" style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: 'var(--color-primary)' }} />
        </div>
      )}

      {logLines.length > 0 && (
        <div ref={logRef} className="text-xs font-mono max-h-28 overflow-y-auto whitespace-pre-wrap p-2 rounded" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
          {logLines.join('\n')}
        </div>
      )}

      {models.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Trained wake words</span>
          <div className="flex gap-2 flex-wrap">
            {models.map((m) => (
              <button key={m.slug} onClick={() => useModel(m.slug, m.path)} className="px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-text-muted)' }}>
                {m.slug.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
