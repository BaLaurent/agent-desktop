import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockOn = vi.fn()
const mockSetToolTip = vi.fn()
const mockSetContextMenu = vi.fn()
const mockSetImage = vi.fn()

vi.mock('electron', () => {
  function TrayMock() {
    return {
      on: mockOn,
      setToolTip: mockSetToolTip,
      setContextMenu: mockSetContextMenu,
      setImage: mockSetImage,
    }
  }
  return {
    app: {
      isPackaged: false,
      getAppPath: () => '/app',
      quit: vi.fn(),
    },
    Tray: TrayMock,
    Menu: { buildFromTemplate: vi.fn((items) => items) },
    nativeImage: { createFromPath: vi.fn(() => ({ setTemplateImage: vi.fn() })) },
    nativeTheme: { shouldUseDarkColors: true, on: vi.fn() },
    BrowserWindow: vi.fn(),
  }
})

vi.mock('./quickChat', () => ({
  showOverlay: vi.fn(),
}))

import { createTray, toggleAppWindow } from './tray'

function createMockWindow(opts: { visible: boolean; focused: boolean; minimized?: boolean; destroyed?: boolean }) {
  return {
    isDestroyed: () => opts.destroyed ?? false,
    isVisible: () => opts.visible,
    isFocused: () => opts.focused,
    isMinimized: () => opts.minimized ?? false,
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    destroy: vi.fn(),
    webContents: { send: vi.fn() },
  } as any
}

describe('toggleAppWindow', () => {
  let mockWin: ReturnType<typeof createMockWindow>
  let ensureWindow: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockWin = createMockWindow({ visible: true, focused: true })
    ensureWindow = vi.fn()
    createTray(() => mockWin, ensureWindow)
  })

  it('hides window when visible and focused', () => {
    toggleAppWindow()
    expect(mockWin.hide).toHaveBeenCalled()
    expect(mockWin.show).not.toHaveBeenCalled()
  })

  it('focuses window when visible but not focused (behind other windows)', () => {
    mockWin = createMockWindow({ visible: true, focused: false })
    createTray(() => mockWin, ensureWindow)

    toggleAppWindow()
    expect(mockWin.hide).not.toHaveBeenCalled()
    expect(mockWin.show).toHaveBeenCalled()
    expect(mockWin.focus).toHaveBeenCalled()
  })

  it('shows and focuses window when hidden', () => {
    mockWin = createMockWindow({ visible: false, focused: false })
    createTray(() => mockWin, ensureWindow)

    toggleAppWindow()
    expect(mockWin.show).toHaveBeenCalled()
    expect(mockWin.focus).toHaveBeenCalled()
  })

  it('restores minimized window', () => {
    mockWin = createMockWindow({ visible: false, focused: false, minimized: true })
    createTray(() => mockWin, ensureWindow)

    toggleAppWindow()
    expect(mockWin.restore).toHaveBeenCalled()
    expect(mockWin.show).toHaveBeenCalled()
    expect(mockWin.focus).toHaveBeenCalled()
  })

  it('creates window when destroyed', () => {
    const freshWin = createMockWindow({ visible: false, focused: false })
    let returnDestroyed = true
    const destroyedWin = createMockWindow({ visible: false, focused: false, destroyed: true })

    createTray(
      () => (returnDestroyed ? destroyedWin : freshWin) as any,
      () => {
        returnDestroyed = false
      },
    )

    toggleAppWindow()
    expect(freshWin.show).toHaveBeenCalled()
    expect(freshWin.focus).toHaveBeenCalled()
  })

  it('creates window when null', () => {
    let win: any = null
    const freshWin = createMockWindow({ visible: false, focused: false })

    createTray(
      () => win,
      () => {
        win = freshWin
      },
    )

    toggleAppWindow()
    expect(freshWin.show).toHaveBeenCalled()
    expect(freshWin.focus).toHaveBeenCalled()
  })
})
