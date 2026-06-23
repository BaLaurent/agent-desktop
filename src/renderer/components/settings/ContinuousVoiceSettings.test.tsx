import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntentPromptEditor, ContinuousVoiceSettings } from './ContinuousVoiceSettings'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_INTENT_PROMPT } from '../../../core/services/voiceIntentPrompt'

// The trainer drives the openWakeWord sidecar over IPC — stub it out of the parent render.
vi.mock('./CustomWakewordTrainer', () => ({ CustomWakewordTrainer: () => null }))

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

describe('ContinuousVoiceSettings — custom intent model toggle', () => {
  beforeEach(() => {
    ;(window as unknown as { agent: unknown }).agent = {
      settings: { set: vi.fn().mockResolvedValue(undefined) },
    }
  })

  function setup(initial: Record<string, string>) {
    useSettingsStore.setState({
      settings: { continuousVoice_enabled: 'true', continuousVoice_gateMode: 'intent', ...initial },
    })
    render(<ContinuousVoiceSettings />)
  }

  const customFieldsVisible = () => screen.queryByLabelText('Custom intent endpoint base URL') !== null

  it('reveals the custom endpoint fields when Custom is clicked from Auto', () => {
    setup({})
    expect(customFieldsVisible()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Custom…' }))
    expect(customFieldsVisible()).toBe(true)
    expect(screen.getByLabelText('Custom intent endpoint API key')).toBeTruthy()
  })

  it('reveals the custom endpoint fields when Custom is clicked from a preset (regression)', async () => {
    setup({ continuousVoice_intentModel: 'claude-haiku-4-5-20251001' })
    expect(customFieldsVisible()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Custom…' }))
    expect(customFieldsVisible()).toBe(true)
    // entering custom from a preset clears the model field (async setSetting) rather than pre-filling the preset id
    await waitFor(() =>
      expect((screen.getByLabelText('Custom intent model') as HTMLInputElement).value).toBe(''),
    )
  })

  it('starts in custom mode when a stored non-preset model loads', () => {
    setup({ continuousVoice_intentModel: 'qwen2.5' })
    expect(customFieldsVisible()).toBe(true)
    const modelInput = screen.getByLabelText('Custom intent model') as HTMLInputElement
    expect(modelInput.value).toBe('qwen2.5')
  })
})
