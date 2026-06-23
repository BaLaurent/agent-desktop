import { render, screen, fireEvent } from '@testing-library/react'
import { LexiconSettings } from './LexiconSettings'
import { useSettingsStore } from '../../stores/settingsStore'

vi.mock('../../stores/settingsStore', () => ({ useSettingsStore: vi.fn() }))

const mockSetSetting = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  mockSetSetting.mockResolvedValue(undefined)
  vi.mocked(useSettingsStore).mockReturnValue({
    settings: { stt_lexicon: '["Zorglub"]' },
    setSetting: mockSetSetting,
  } as any)
})

describe('LexiconSettings', () => {
  it('renders existing lexicon entries', () => {
    render(<LexiconSettings />)
    expect(screen.getByText('Zorglub')).toBeDefined()
  })

  it('adds a new word', () => {
    render(<LexiconSettings />)
    const input = screen.getByLabelText('New lexicon word')
    fireEvent.change(input, { target: { value: 'Toto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add word to lexicon' }))
    expect(mockSetSetting).toHaveBeenCalledWith('stt_lexicon', '["Zorglub","Toto"]')
  })

  it('removes a word', () => {
    render(<LexiconSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Zorglub' }))
    expect(mockSetSetting).toHaveBeenCalledWith('stt_lexicon', '[]')
  })
})
