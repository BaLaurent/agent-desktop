import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WebServerSettings } from './WebServerSettings'
import { useSettingsStore } from '../../stores/settingsStore'

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: vi.fn(),
}))

vi.mock('qrcode', () => ({
  toString: vi.fn(),
}))

const mockGetStatus = vi.fn().mockResolvedValue({
  running: false,
  port: null,
  url: null,
  urlHostname: null,
  lanIp: null,
  hostname: null,
  token: null,
  clients: 0,
  firewallWarning: null,
})

const mockStart = vi.fn().mockResolvedValue({ url: 'http://192.168.1.10:3484?token=abc', token: 'abc' })
const mockStop = vi.fn().mockResolvedValue(undefined)

const mockSetSetting = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  vi.clearAllMocks()
  ;(window.agent as Record<string, unknown>).server = {
    start: mockStart,
    stop: mockStop,
    getStatus: mockGetStatus,
  }

  vi.mocked(useSettingsStore).mockReturnValue({
    settings: { server_enabled: 'false', server_port: '3484', server_autoStart: 'false' },
    setSetting: mockSetSetting,
  } as any)
})

describe('WebServerSettings', () => {
  it('renders the enable toggle', () => {
    render(<WebServerSettings />)
    expect(screen.getByText('Enable Web Server')).toBeDefined()
  })

  it('renders port input', () => {
    render(<WebServerSettings />)
    expect(screen.getByText('Port')).toBeDefined()
  })

  it('renders auto-start toggle', () => {
    render(<WebServerSettings />)
    expect(screen.getByText('Auto-start on launch')).toBeDefined()
  })

  it('renders info text', () => {
    render(<WebServerSettings />)
    expect(screen.getByText(/serves the same interface/i)).toBeDefined()
  })

  it('calls server.start with port when enabling', async () => {
    render(<WebServerSettings />)

    const toggle = screen.getByRole('switch', { name: 'Enable web server' })
    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(mockStart).toHaveBeenCalledWith(3484)
    expect(mockSetSetting).toHaveBeenCalledWith('server_enabled', 'true')
    expect(mockSetSetting).toHaveBeenCalledWith('server_port', '3484')
  })

  it('calls server.stop when disabling', async () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { server_enabled: 'true', server_port: '3484', server_autoStart: 'false' },
      setSetting: mockSetSetting,
    } as any)

    render(<WebServerSettings />)

    const toggle = screen.getByRole('switch', { name: 'Enable web server' })
    await act(async () => {
      fireEvent.click(toggle)
    })

    expect(mockStop).toHaveBeenCalled()
    expect(mockSetSetting).toHaveBeenCalledWith('server_enabled', 'false')
  })

  it('port input is disabled when server is enabled', () => {
    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { server_enabled: 'true', server_port: '3484', server_autoStart: 'false' },
      setSetting: mockSetSetting,
    } as any)

    render(<WebServerSettings />)

    const portInput = screen.getByDisplayValue('3484')
    expect(portInput).toBeDisabled()
  })

  it('shows status section when server is running', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      port: 3484,
      url: 'http://192.168.1.10:3484?token=abc',
      urlHostname: null,
      lanIp: '192.168.1.10',
      hostname: null,
      token: 'abc123',
      clients: 2,
      firewallWarning: null,
    })

    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { server_enabled: 'true', server_port: '3484', server_autoStart: 'false' },
      setSetting: mockSetSetting,
    } as any)

    render(<WebServerSettings />)

    await waitFor(() => {
      expect(screen.getByText(/Server running/)).toBeDefined()
    })

    expect(screen.getByText(/2 clients connected/)).toBeDefined()
  })

  it('shows firewall warning when present', async () => {
    mockGetStatus.mockResolvedValue({
      running: true,
      port: 3484,
      url: 'http://192.168.1.10:3484?token=abc',
      urlHostname: null,
      lanIp: '192.168.1.10',
      hostname: null,
      token: 'abc123',
      clients: 0,
      firewallWarning: 'sudo ufw allow 3484/tcp',
    })

    vi.mocked(useSettingsStore).mockReturnValue({
      settings: { server_enabled: 'true', server_port: '3484', server_autoStart: 'false' },
      setSetting: mockSetSetting,
    } as any)

    render(<WebServerSettings />)

    await waitFor(() => {
      expect(screen.getByText('Firewall may be blocking remote access')).toBeDefined()
    })

    expect(screen.getByText('sudo ufw allow 3484/tcp')).toBeDefined()
  })

  it('auto-start toggle calls setSetting', async () => {
    render(<WebServerSettings />)

    const autoStartToggle = screen.getByRole('switch', { name: 'Auto-start web server' })
    await act(async () => {
      fireEvent.click(autoStartToggle)
    })

    expect(mockSetSetting).toHaveBeenCalledWith('server_autoStart', 'true')
  })
})
