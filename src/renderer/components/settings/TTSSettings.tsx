import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'

interface DetectedPlayer {
  name: string
  path: string
  available: boolean
}

interface ValidationResult {
  provider: string | null
  providerFound: boolean
  playerFound: boolean
  playerPath: string
  error?: string
}

const inputStyle = {
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)',
}

const DEFAULT_SUMMARY_PROMPT =
  'Summarize the following AI response in 1-2 concise sentences suitable for text-to-speech. Focus on the key information and actionable points. Respond with ONLY the summary.\n\n{response}'

export function TTSSettings() {
  const { settings, setSetting } = useSettingsStore()

  const [players, setPlayers] = useState<DetectedPlayer[]>([])
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [testing, setTesting] = useState(false)

  const provider = settings.tts_provider || ''
  const piperUrl = settings.tts_piperUrl || ''
  const edgettsVoice = settings.tts_edgettsVoice || ''
  const edgettsBinary = settings.tts_edgettsBinary || ''
  const playerPath = settings.tts_playerPath || 'auto'
  const maxLength = settings.tts_maxLength || '2000'
  const responseMode = settings.tts_responseMode || 'off'
  const autoWordLimit = settings.tts_autoWordLimit || '200'
  const summaryPrompt = settings.tts_summaryPrompt || ''

  // Detect available audio players on mount
  useEffect(() => {
    window.agent.tts.detectPlayers().then(setPlayers).catch(() => {})
  }, [])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setValidation(null)
    try {
      const result = await window.agent.tts.validate()
      setValidation(result)
      if (result.providerFound && (result.playerFound || provider === 'spd-say')) {
        try {
          await window.agent.tts.speak('This is a test of the text to speech system.')
        } catch (speakErr) {
          const msg = speakErr instanceof Error ? speakErr.message : 'Speech failed'
          setValidation(prev => prev ? { ...prev, error: (prev.error ? prev.error + '; ' : '') + msg } : prev)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Validation failed'
      setValidation({ provider: null, providerFound: false, playerFound: false, playerPath: '', error: msg })
    } finally {
      setTesting(false)
    }
  }, [provider])

  const isPlayerCustom = playerPath !== 'auto' && !players.some((p) => p.path === playerPath)
  const showPlayerSelect = provider === 'piper' || provider === 'edgetts'

  return (
    <div className="flex flex-col gap-6">
      {/* Info */}
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Text-to-speech supports three providers:{' '}
        <span className="font-medium" style={{ color: 'var(--color-text)' }}>Piper</span> (local HTTP server),{' '}
        <span className="font-medium" style={{ color: 'var(--color-text)' }}>EdgeTTS</span> (Microsoft Edge voices via CLI), and{' '}
        <span className="font-medium" style={{ color: 'var(--color-text)' }}>spd-say</span> (speech-dispatcher, no extra setup).
        Piper and EdgeTTS require an audio player (aplay, paplay, ffplay, or mpv) to play generated audio files.
      </p>

      {/* Provider */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Provider
        </label>
        <select
          value={provider}
          onChange={(e) => {
            setSetting('tts_provider', e.target.value)
            setValidation(null)
          }}
          className="w-full px-3 py-2 rounded text-sm outline-none"
          style={inputStyle}
          aria-label="TTS provider"
        >
          <option value="">Off</option>
          <option value="piper">Piper (HTTP)</option>
          <option value="edgetts">EdgeTTS</option>
          <option value="spd-say">spd-say</option>
        </select>
      </div>

      {/* Piper: Server URL */}
      {provider === 'piper' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Server URL
          </label>
          <input
            type="text"
            value={piperUrl}
            onChange={(e) => setSetting('tts_piperUrl', e.target.value)}
            placeholder="http://localhost:5000"
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={inputStyle}
            aria-label="Piper server URL"
          />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            URL of your running Piper TTS HTTP server
          </span>
        </div>
      )}

      {/* EdgeTTS: Voice */}
      {provider === 'edgetts' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Voice
            </label>
            <input
              type="text"
              value={edgettsVoice}
              onChange={(e) => setSetting('tts_edgettsVoice', e.target.value)}
              placeholder="en-US-AriaNeural"
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={inputStyle}
              aria-label="EdgeTTS voice"
            />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Microsoft Edge voice name (run <code>edge-tts --list-voices</code> to see available voices)
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Binary Path
            </label>
            <input
              type="text"
              value={edgettsBinary}
              onChange={(e) => setSetting('tts_edgettsBinary', e.target.value)}
              placeholder="edge-tts"
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={inputStyle}
              aria-label="EdgeTTS binary path"
            />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Full path or command name if it's in your PATH (e.g. edge-tts, /usr/bin/edge-tts)
            </span>
          </div>
        </>
      )}

      {/* Audio Player (Piper & EdgeTTS only) */}
      {showPlayerSelect && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Audio Player
          </label>
          <select
            value={isPlayerCustom ? '__custom__' : playerPath}
            onChange={(e) => {
              const val = e.target.value
              if (val === '__custom__') {
                setSetting('tts_playerPath', '')
              } else {
                setSetting('tts_playerPath', val)
              }
              setValidation(null)
            }}
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={inputStyle}
            aria-label="Audio player"
          >
            <option value="auto">Auto-detect</option>
            {players
              .filter((p) => p.available)
              .map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name}
                </option>
              ))}
            <option value="__custom__">Custom</option>
          </select>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Audio player used to play generated speech files
          </span>
        </div>
      )}

      {/* Custom player path */}
      {showPlayerSelect && isPlayerCustom && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Player Path
          </label>
          <input
            type="text"
            value={playerPath === 'auto' ? '' : playerPath}
            onChange={(e) => setSetting('tts_playerPath', e.target.value)}
            placeholder="/usr/bin/aplay"
            className="w-full px-3 py-2 rounded text-sm outline-none"
            style={inputStyle}
            aria-label="Custom player path"
          />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Full path to audio player binary
          </span>
        </div>
      )}

      {/* Max Text Length */}
      {provider && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Max Text Length
          </label>
          <input
            type="number"
            value={maxLength}
            onChange={(e) => setSetting('tts_maxLength', e.target.value)}
            min={0}
            max={50000}
            step={100}
            className="w-32 px-3 py-2 rounded text-sm outline-none"
            style={inputStyle}
            aria-label="Max text length"
          />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Maximum characters to send to the TTS provider (0 = no limit)
          </span>
        </div>
      )}

      {/* Test button + results */}
      {provider && (
        <div className="flex flex-col gap-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="self-start px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 bg-tool text-contrast"
            style={{ opacity: testing ? 0.6 : 1 }}
          >
            {testing ? 'Testing...' : 'Test Voice'}
          </button>

          {validation && (
            <div
              className="flex flex-col gap-1.5 px-3 py-2 rounded text-sm"
              style={{
                backgroundColor: 'var(--color-bg)',
                border: `1px solid ${validation.providerFound && validation.playerFound ? 'var(--color-success)' : 'var(--color-error)'}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span>{validation.providerFound ? '\u2713' : '\u2717'}</span>
                <span style={{ color: validation.providerFound ? 'var(--color-success)' : 'var(--color-error)' }}>
                  Provider: {validation.provider || '(not configured)'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>{validation.playerFound ? '\u2713' : '\u2717'}</span>
                <span style={{ color: validation.playerFound ? 'var(--color-success)' : 'var(--color-error)' }}>
                  Player: {validation.playerPath || '(not found)'}
                </span>
              </div>
              {validation.error && (
                <div className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>
                  {validation.error}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI Response TTS section */}
      {provider && (
        <>
          <div
            className="border-t pt-4"
            style={{ borderColor: 'var(--color-text-muted)', opacity: 0.2 }}
          />
          <h4
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--color-text-muted)' }}
          >
            AI Response TTS
          </h4>

          {/* Response Mode */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Response Mode
            </label>
            <select
              value={responseMode}
              onChange={(e) => setSetting('tts_responseMode', e.target.value)}
              className="w-full px-3 py-2 rounded text-sm outline-none"
              style={inputStyle}
              aria-label="TTS response mode"
            >
              <option value="off">Off</option>
              <option value="full">Full Response</option>
              <option value="summary">Summary (Haiku)</option>
              <option value="auto">Auto (Full or Summary)</option>
            </select>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Automatically speak AI responses. &quot;Auto&quot; reads in full if under the word limit, otherwise summarizes.
            </span>
          </div>

          {/* Auto mode: word limit */}
          {responseMode === 'auto' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                Word Limit
              </label>
              <input
                type="number"
                value={autoWordLimit}
                onChange={(e) => setSetting('tts_autoWordLimit', e.target.value)}
                min={10}
                max={10000}
                step={10}
                className="w-32 px-3 py-2 rounded text-sm outline-none"
                style={inputStyle}
                aria-label="Auto mode word limit"
              />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Responses under this word count are read in full; longer ones are summarized via Haiku.
              </span>
            </div>
          )}

          {/* Summary prompt */}
          {(responseMode === 'summary' || responseMode === 'auto') && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                Summary Prompt
              </label>
              <textarea
                value={summaryPrompt}
                onChange={(e) => setSetting('tts_summaryPrompt', e.target.value)}
                placeholder={DEFAULT_SUMMARY_PROMPT}
                rows={4}
                className="w-full px-3 py-2 rounded text-sm outline-none resize-y"
                style={inputStyle}
                aria-label="Summary prompt"
              />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Prompt sent to Haiku to summarize responses for speech. Use <code>{'{response}'}</code> as a placeholder for the AI response text.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
