import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { readContinuousVoiceFlags } from './config'

function setSettings(s: Record<string, string>) {
  useSettingsStore.setState({ settings: s } as never)
}

describe('readContinuousVoiceFlags.pauseDuringProcessing', () => {
  beforeEach(() => setSettings({}))

  it('defaults to true when the setting is absent', () => {
    expect(readContinuousVoiceFlags().pauseDuringProcessing).toBe(true)
  })

  it('is true when the stored value is not "false"', () => {
    setSettings({ continuousVoice_pauseDuringProcessing: 'true' })
    expect(readContinuousVoiceFlags().pauseDuringProcessing).toBe(true)
  })

  it('is false only when the stored value is exactly "false"', () => {
    setSettings({ continuousVoice_pauseDuringProcessing: 'false' })
    expect(readContinuousVoiceFlags().pauseDuringProcessing).toBe(false)
  })
})
