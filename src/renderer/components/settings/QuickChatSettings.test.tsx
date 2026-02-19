import { render, screen, fireEvent } from '@testing-library/react'
import { useSettingsStore } from '../../stores/settingsStore'
import { QuickChatSettings } from './QuickChatSettings'

const mockPurge = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  // Inject quickChat namespace into the existing window.agent mock
  ;(window.agent as Record<string, unknown>).quickChat = { purge: mockPurge }

  useSettingsStore.setState({
    settings: {
      quickChat_responseNotification: 'true',
      quickChat_responseBubble: 'false',
    },
    setSetting: vi.fn().mockResolvedValue(undefined),
  })

  mockPurge.mockClear()
})

describe('QuickChatSettings', () => {
  it('renders description text referencing the Shortcuts tab', () => {
    render(<QuickChatSettings />)
    expect(screen.getByText(/Configure shortcuts in the/)).toBeInTheDocument()
    expect(screen.getByText('Shortcuts')).toBeInTheDocument()
  })

  it('notification checkbox reflects settings value', () => {
    render(<QuickChatSettings />)
    const checkbox = screen.getByLabelText(/desktop notification/i) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })

  it('toggling notification checkbox calls setSetting', () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    useSettingsStore.setState({ setSetting })

    render(<QuickChatSettings />)
    const checkbox = screen.getByLabelText(/desktop notification/i)
    fireEvent.click(checkbox)

    expect(setSetting).toHaveBeenCalledWith('quickChat_responseNotification', 'false')
  })

  it('bubble checkbox reflects settings value', () => {
    render(<QuickChatSettings />)
    const checkbox = screen.getByLabelText(/response bubble/i) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
  })

  it('toggling bubble checkbox calls setSetting', () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    useSettingsStore.setState({ setSetting })

    render(<QuickChatSettings />)
    const checkbox = screen.getByLabelText(/response bubble/i)
    fireEvent.click(checkbox)

    expect(setSetting).toHaveBeenCalledWith('quickChat_responseBubble', 'true')
  })

  it('purge button calls window.agent.quickChat.purge()', () => {
    render(<QuickChatSettings />)
    fireEvent.click(screen.getByText('Purge Quick Chat History'))
    expect(mockPurge).toHaveBeenCalledOnce()
  })

  it('renders volume duck slider with default value 0', () => {
    render(<QuickChatSettings />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider).toBeInTheDocument()
    expect(slider.value).toBe('0')
  })

  it('volume duck slider reflects settings value', () => {
    useSettingsStore.setState({
      settings: { voice_volumeDuck: '50' },
      setSetting: vi.fn().mockResolvedValue(undefined),
    })

    render(<QuickChatSettings />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.value).toBe('50')
  })

  it('changing volume duck slider calls setSetting', () => {
    const setSetting = vi.fn().mockResolvedValue(undefined)
    useSettingsStore.setState({ setSetting })

    render(<QuickChatSettings />)
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '30' } })

    expect(setSetting).toHaveBeenCalledWith('voice_volumeDuck', '30')
  })
})
