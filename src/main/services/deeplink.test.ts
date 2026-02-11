import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { App, BrowserWindow } from 'electron'

// Mock the main index module (getMainWindow)
vi.mock('../index', () => ({
  getMainWindow: vi.fn(),
}))

// Mock the system module (log)
vi.mock('./system', () => ({
  log: vi.fn(),
}))

describe('DeepLink Service', () => {
  let mockApp: Partial<App>
  let mockWindow: Partial<BrowserWindow>

  beforeEach(async () => {
    vi.clearAllMocks()

    mockWindow = {
      webContents: {
        send: vi.fn(),
      } as any,
      show: vi.fn(),
      focus: vi.fn(),
    }

    mockApp = {
      setAsDefaultProtocolClient: vi.fn(),
      on: vi.fn(),
    }

    // Import after mocks are set up
    const { getMainWindow } = await import('../index')
    vi.mocked(getMainWindow).mockReturnValue(mockWindow as BrowserWindow)
  })

  it('registers agent protocol on setup', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    setupDeepLinks(mockApp as App)

    expect(mockApp.setAsDefaultProtocolClient).toHaveBeenCalledWith('agent')
  })

  it('registers open-url handler for macOS', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    setupDeepLinks(mockApp as App)

    expect(mockApp.on).toHaveBeenCalledWith('open-url', expect.any(Function))
  })

  it('registers second-instance handler for Linux/Windows', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    setupDeepLinks(mockApp as App)

    expect(mockApp.on).toHaveBeenCalledWith('second-instance', expect.any(Function))
  })

  it('handles agent://conversation/123 URL', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    setupDeepLinks(mockApp as App)

    // Get the open-url handler
    const onOpenUrl = vi.mocked(mockApp.on).mock.calls.find((call) => call[0] === 'open-url')?.[1]
    expect(onOpenUrl).toBeDefined()

    // Simulate open-url event
    onOpenUrl?.({} as any, 'agent://conversation/123')

    expect(mockWindow.webContents?.send).toHaveBeenCalledWith('deeplink:navigate', 123)
    expect(mockWindow.show).toHaveBeenCalled()
    expect(mockWindow.focus).toHaveBeenCalled()
  })

  it('ignores invalid conversation ID', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    const { log } = await import('./system')
    setupDeepLinks(mockApp as App)

    const onOpenUrl = vi.mocked(mockApp.on).mock.calls.find((call) => call[0] === 'open-url')?.[1]
    onOpenUrl?.({} as any, 'agent://conversation/invalid')

    expect(mockWindow.webContents?.send).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('invalid conversation ID'), expect.any(String))
  })

  it('handles second-instance with agent URL', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    setupDeepLinks(mockApp as App)

    const onSecondInstance = vi.mocked(mockApp.on).mock.calls.find(
      (call) => call[0] === 'second-instance'
    )?.[1]
    expect(onSecondInstance).toBeDefined()

    // Simulate second-instance event
    onSecondInstance?.({} as any, ['', '', 'agent://conversation/456'])

    expect(mockWindow.webContents?.send).toHaveBeenCalledWith('deeplink:navigate', 456)
    expect(mockWindow.show).toHaveBeenCalled()
    expect(mockWindow.focus).toHaveBeenCalled()
  })

  it('ignores second-instance without agent URL', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    setupDeepLinks(mockApp as App)

    const onSecondInstance = vi.mocked(mockApp.on).mock.calls.find(
      (call) => call[0] === 'second-instance'
    )?.[1]

    onSecondInstance?.({} as any, ['', '', 'some-other-arg'])

    expect(mockWindow.webContents?.send).not.toHaveBeenCalled()
  })

  it('handles malformed URL gracefully', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    const { log } = await import('./system')
    setupDeepLinks(mockApp as App)

    const onOpenUrl = vi.mocked(mockApp.on).mock.calls.find((call) => call[0] === 'open-url')?.[1]
    onOpenUrl?.({} as any, 'not-a-valid-url-at-all')

    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('Failed to parse deep link'), expect.any(String))
  })

  it('logs info for unrecognized agent URLs', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    const { log } = await import('./system')
    setupDeepLinks(mockApp as App)

    const onOpenUrl = vi.mocked(mockApp.on).mock.calls.find((call) => call[0] === 'open-url')?.[1]
    onOpenUrl?.({} as any, 'agent://unknown/path')

    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('Deep link received'))
  })

  it('handles missing window gracefully', async () => {
    const { setupDeepLinks } = await import('./deeplink')
    const { getMainWindow } = await import('../index')
    vi.mocked(getMainWindow).mockReturnValue(null as any)

    setupDeepLinks(mockApp as App)

    const onOpenUrl = vi.mocked(mockApp.on).mock.calls.find((call) => call[0] === 'open-url')?.[1]
    onOpenUrl?.({} as any, 'agent://conversation/123')

    // Should not throw, just skip window operations
    expect(mockWindow.show).not.toHaveBeenCalled()
  })
})
