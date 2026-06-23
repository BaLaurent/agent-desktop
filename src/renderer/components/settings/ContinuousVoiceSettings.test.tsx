import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntentPromptEditor } from './ContinuousVoiceSettings'
import { DEFAULT_INTENT_PROMPT } from '../../../core/services/voiceIntentPrompt'

describe('IntentPromptEditor', () => {
  it('prefills the textarea with the default when nothing is stored', () => {
    render(<IntentPromptEditor stored="" onPersist={vi.fn()} />)
    const ta = screen.getByLabelText('Intent classification prompt') as HTMLTextAreaElement
    expect(ta.value).toBe(DEFAULT_INTENT_PROMPT)
  })

  it('stays empty after the user clears it (no snap-back) and persists empty string', () => {
    const onPersist = vi.fn()
    render(<IntentPromptEditor stored="" onPersist={onPersist} />)
    const ta = screen.getByLabelText('Intent classification prompt') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '' } })
    expect(ta.value).toBe('')
    expect(onPersist).toHaveBeenLastCalledWith('')
  })

  it('persists a custom value verbatim when edited away from the default', () => {
    const onPersist = vi.fn()
    render(<IntentPromptEditor stored="" onPersist={onPersist} />)
    const ta = screen.getByLabelText('Intent classification prompt') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'custom {utterance}' } })
    expect(onPersist).toHaveBeenLastCalledWith('custom {utterance}')
  })

  it('persists empty string when the draft is edited back to exactly the default', () => {
    const onPersist = vi.fn()
    render(<IntentPromptEditor stored="custom" onPersist={onPersist} />)
    const ta = screen.getByLabelText('Intent classification prompt') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: DEFAULT_INTENT_PROMPT } })
    expect(onPersist).toHaveBeenLastCalledWith('')
  })

  it('shows the reset button only when an override is stored, and resets to default', () => {
    const onPersist = vi.fn()
    const { rerender } = render(<IntentPromptEditor stored="" onPersist={onPersist} />)
    expect(screen.queryByRole('button', { name: /reset to default/i })).toBeNull()

    rerender(<IntentPromptEditor stored="custom prompt" onPersist={onPersist} />)
    const btn = screen.getByRole('button', { name: /reset to default/i })
    fireEvent.click(btn)
    const ta = screen.getByLabelText('Intent classification prompt') as HTMLTextAreaElement
    expect(ta.value).toBe(DEFAULT_INTENT_PROMPT)
    expect(onPersist).toHaveBeenLastCalledWith('')
  })
})
