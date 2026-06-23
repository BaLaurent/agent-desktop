import { render, screen, fireEvent } from '@testing-library/react'
import { VoiceInputSettings } from './VoiceInputSettings'
import { useSettingsStore } from '../../stores/settingsStore'

vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }))

const mockSetSetting = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  mockSetSetting.mockResolvedValue(undefined)
  ;(window.agent as Record<string, unknown>).sherpa = {
    listInstalledModels: vi.fn().mockResolvedValue([]),
    onDownloadProgress: vi.fn().mockReturnValue(() => {}),
    validateConfig: vi.fn().mockResolvedValue({ detected: null, files: [], ok: false }),
  }
  ;(window.agent as Record<string, unknown>).system = {
    selectFile: vi.fn().mockResolvedValue(null),
    openExternal: vi.fn().mockResolvedValue(undefined),
  }
  ;(window.agent as Record<string, unknown>).whisper = {
    validateConfig: vi.fn().mockResolvedValue({ binaryFound: false, modelFound: false, binaryPath: '', modelPath: '' }),
  }
  vi.mocked(useSettingsStore).mockReturnValue({
    settings: { stt_backend: 'whisper', stt_lexicon: '["Zorglub","Toto"]', whisper_advancedParams: '' },
    setSetting: mockSetSetting,
  } as any)
})

describe('VoiceInputSettings — apply lexicon to prompt', () => {
  it('writes the lexicon into the whisper prompt', () => {
    render(<VoiceInputSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply lexicon to prompt' }))
    expect(mockSetSetting).toHaveBeenCalledWith('whisper_advancedParams', JSON.stringify({ prompt: 'Zorglub, Toto' }))
  })

  it('button is disabled when lexicon is empty', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { stt_backend: 'whisper', stt_lexicon: '[]', whisper_advancedParams: '' },
      setSetting: mockSetSetting,
    } as any)
    render(<VoiceInputSettings />)
    const btn = screen.getByRole('button', { name: 'Apply lexicon to prompt' })
    expect(btn).toBeDisabled()
  })

  it('button is disabled when lexicon is absent', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { stt_backend: 'whisper', stt_lexicon: '', whisper_advancedParams: '' },
      setSetting: mockSetSetting,
    } as any)
    render(<VoiceInputSettings />)
    const btn = screen.getByRole('button', { name: 'Apply lexicon to prompt' })
    expect(btn).toBeDisabled()
  })
})
