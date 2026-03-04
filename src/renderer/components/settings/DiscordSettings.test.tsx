import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { DiscordSettings } from './DiscordSettings'
import { useSettingsStore } from '../../stores/settingsStore'

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: vi.fn(),
}))

const mockConnect = vi.fn().mockResolvedValue(undefined)
const mockDisconnect = vi.fn().mockResolvedValue(undefined)
const mockStatus = vi.fn().mockResolvedValue({ connected: false })

const mockSetSetting = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  mockConnect.mockResolvedValue(undefined)
  mockDisconnect.mockResolvedValue(undefined)
  mockStatus.mockResolvedValue({ connected: false })
  mockSetSetting.mockResolvedValue(undefined)
  ;(window.agent as Record<string, unknown>).discord = {
    connect: mockConnect,
    disconnect: mockDisconnect,
    status: mockStatus,
  }

  vi.mocked(useSettingsStore).mockReturnValue({
    settings: { discord_enabled: 'false', discord_botToken: '' },
    setSetting: mockSetSetting,
  } as any)
})

describe('DiscordSettings', () => {
  it('renders the enable toggle', () => {
    render(<DiscordSettings />)
    expect(screen.getByText('Enable Discord Bot')).toBeDefined()
    expect(screen.getByRole('switch', { name: 'Enable Discord bot' })).toBeDefined()
  })

  it('renders the token input', () => {
    render(<DiscordSettings />)
    expect(screen.getByText('Bot Token')).toBeDefined()
    expect(screen.getByLabelText('Bot token')).toBeDefined()
  })

  it('renders connection status display', () => {
    render(<DiscordSettings />)
    expect(screen.getByText('Disconnected')).toBeDefined()
  })

  it('renders info text', () => {
    render(<DiscordSettings />)
    expect(screen.getByText(/slash commands to interact/i)).toBeDefined()
  })

  it('toggle saves discord_enabled and calls connect when enabling', async () => {
    render(<DiscordSettings />)

    const toggle = screen.getByRole('switch', { name: 'Enable Discord bot' })
    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(mockSetSetting).toHaveBeenCalledWith('discord_enabled', 'true')
    expect(mockSetSetting).toHaveBeenCalledWith('discord_botToken', '')
    expect(mockConnect).toHaveBeenCalled()
  })

  it('toggle calls disconnect and saves discord_enabled when disabling', async () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { discord_enabled: 'true', discord_botToken: 'test-token' },
      setSetting: mockSetSetting,
    } as any)

    render(<DiscordSettings />)

    const toggle = screen.getByRole('switch', { name: 'Enable Discord bot' })
    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(mockDisconnect).toHaveBeenCalled()
    expect(mockSetSetting).toHaveBeenCalledWith('discord_enabled', 'false')
  })

  it('token input saves on blur', async () => {
    render(<DiscordSettings />)

    const input = screen.getByLabelText('Bot token')
    fireEvent.change(input, { target: { value: 'my-new-token' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(mockSetSetting).toHaveBeenCalledWith('discord_botToken', 'my-new-token')
    })
  })

  it('token input is disabled when connected', async () => {
    mockStatus.mockResolvedValue({ connected: true, username: 'TestBot', guildCount: 3 })

    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { discord_enabled: 'true', discord_botToken: 'test-token' },
      setSetting: mockSetSetting,
    } as any)

    render(<DiscordSettings />)

    await waitFor(() => {
      expect(screen.getByLabelText('Bot token')).toBeDisabled()
    })
  })

  it('connect button calls discord.connect()', async () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { discord_enabled: 'true', discord_botToken: 'test-token' },
      setSetting: mockSetSetting,
    } as any)

    render(<DiscordSettings />)

    await waitFor(() => {
      expect(screen.getByText('Connect')).toBeDefined()
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Connect'))
    })

    expect(mockConnect).toHaveBeenCalled()
  })

  it('disconnect button visible when connected', async () => {
    mockStatus.mockResolvedValue({ connected: true, username: 'TestBot', guildCount: 3 })

    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { discord_enabled: 'true', discord_botToken: 'test-token' },
      setSetting: mockSetSetting,
    } as any)

    render(<DiscordSettings />)

    await waitFor(() => {
      expect(screen.getByText('Disconnect')).toBeDefined()
    })
  })

  it('disconnect button calls discord.disconnect()', async () => {
    mockStatus.mockResolvedValue({ connected: true, username: 'TestBot', guildCount: 3 })

    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { discord_enabled: 'true', discord_botToken: 'test-token' },
      setSetting: mockSetSetting,
    } as any)

    render(<DiscordSettings />)

    await waitFor(() => {
      expect(screen.getByText('Disconnect')).toBeDefined()
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Disconnect'))
    })

    expect(mockDisconnect).toHaveBeenCalled()
  })

  it('shows username and guild count when connected', async () => {
    mockStatus.mockResolvedValue({ connected: true, username: 'TestBot', guildCount: 5 })

    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { discord_enabled: 'true', discord_botToken: 'test-token' },
      setSetting: mockSetSetting,
    } as any)

    render(<DiscordSettings />)

    await waitFor(() => {
      expect(screen.getByText('Connected as TestBot')).toBeDefined()
    })

    expect(screen.getByText('Active in 5 servers')).toBeDefined()
  })

  it('shows singular "server" when guild count is 1', async () => {
    mockStatus.mockResolvedValue({ connected: true, username: 'TestBot', guildCount: 1 })

    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { discord_enabled: 'true', discord_botToken: 'test-token' },
      setSetting: mockSetSetting,
    } as any)

    render(<DiscordSettings />)

    await waitFor(() => {
      expect(screen.getByText('Active in 1 server')).toBeDefined()
    })
  })

  it('status polling starts when enabled', async () => {
    vi.useFakeTimers()

    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { discord_enabled: 'true', discord_botToken: 'test-token' },
      setSetting: mockSetSetting,
    } as any)

    render(<DiscordSettings />)

    // Initial fetch
    expect(mockStatus).toHaveBeenCalledTimes(1)

    // Advance past one poll interval (5s)
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(mockStatus).toHaveBeenCalledTimes(2)

    // Advance past another poll interval
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(mockStatus).toHaveBeenCalledTimes(3)

    vi.useRealTimers()
  })

  it('does not poll when disabled', async () => {
    vi.useFakeTimers()

    render(<DiscordSettings />)

    // Initial fetch
    expect(mockStatus).toHaveBeenCalledTimes(1)

    // Advance past poll interval
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    // Should not have polled again
    expect(mockStatus).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('show/hide token button toggles input type', () => {
    render(<DiscordSettings />)

    const input = screen.getByLabelText('Bot token')
    expect(input).toHaveAttribute('type', 'password')

    fireEvent.click(screen.getByText('Show'))
    expect(input).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByText('Hide'))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('does not show connect/disconnect buttons when disabled', () => {
    render(<DiscordSettings />)

    expect(screen.queryByText('Connect')).toBeNull()
    expect(screen.queryByText('Disconnect')).toBeNull()
  })
})
