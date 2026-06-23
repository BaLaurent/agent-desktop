import { useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'

const inputStyle = {
  backgroundColor: 'var(--color-base)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)',
}

function parseLexicon(raw: string | undefined): string[] {
  try {
    const v = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string') : []
  } catch {
    return []
  }
}

/**
 * Shared, engine-agnostic editor for the custom-word lexicon (`stt_lexicon`).
 * Sherpa consumes it as hotwords; Whisper can pull it into the initial prompt.
 */
export function LexiconSettings() {
  const { settings, setSetting } = useSettingsStore()
  const words = parseLexicon(settings.stt_lexicon)
  const [draft, setDraft] = useState('')

  const commit = useCallback((next: string[]) => setSetting('stt_lexicon', JSON.stringify(next)), [setSetting])

  const addWord = useCallback(() => {
    const w = draft.trim()
    if (!w || words.includes(w)) return
    commit([...words, w])
    setDraft('')
  }, [draft, words, commit])

  const removeWord = useCallback((w: string) => commit(words.filter((x) => x !== w)), [words, commit])

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        Custom word lexicon
      </label>
      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Words you use often that get mis-recognized (names, jargon). Applied as Sherpa hotwords and
        can pre-fill the Whisper prompt.
      </span>

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addWord() } }}
          placeholder="Add a word…"
          className="flex-1 px-3 py-2 rounded text-sm outline-none"
          style={inputStyle}
          aria-label="New lexicon word"
        />
        <button
          onClick={addWord}
          className="px-3 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-base)' }}
          aria-label="Add word to lexicon"
        >
          Add
        </button>
      </div>

      {words.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {words.map((w) => (
            <span
              key={w}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-sm"
              style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text)' }}
            >
              {w}
              <button
                onClick={() => removeWord(w)}
                className="text-xs leading-none transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label={`Remove ${w}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
