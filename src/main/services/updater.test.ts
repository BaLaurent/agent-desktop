import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0' },
  BrowserWindow: vi.fn(),
  shell: { openExternal: vi.fn() },
  Notification: vi.fn(() => ({ show: vi.fn() })),
}))

import { autoUpdater } from 'electron-updater'
import { shell } from 'electron'

import {
  registerHandlers,
  initAutoUpdater,
  stopAutoUpdater,
  checkForUpdates,
  installUpdate,
} from './updater'

function createMockIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>()
  return {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    },
    invoke: async (channel: string, ...args: any[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler({} as any, ...args)
    },
  }
}

describe('Updater Service', () => {
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(() => {
    vi.clearAllMocks()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any)
  })

  describe('updates:check', () => {
    it('returns available when newer version exists', async () => {
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
        updateInfo: { version: '1.2.0', releaseDate: '2025-01-15' },
      } as any)

      const result = await ipc.invoke('updates:check')
      expect(result).toEqual({
        available: true,
        version: '1.2.0',
        releaseDate: '2025-01-15',
      })
    })

    it('returns not available when same version', async () => {
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
        updateInfo: { version: '1.0.0', releaseDate: '2025-01-15' },
      } as any)

      const result = await ipc.invoke('updates:check')
      expect(result).toEqual({
        available: false,
        version: '1.0.0',
        releaseDate: '2025-01-15',
      })
    })

    it('returns not available when result is null', async () => {
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null as any)

      const result = await ipc.invoke('updates:check')
      expect(result).toEqual({ available: false })
    })

    it('returns not available on error', async () => {
      vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('network error'))

      const result = await ipc.invoke('updates:check')
      expect(result).toEqual({ available: false })
    })
  })

  describe('updates:download', () => {
    it('calls autoUpdater.downloadUpdate for AppImage', async () => {
      const origAppImage = process.env.APPIMAGE
      process.env.APPIMAGE = '/tmp/.mount_Agent123/AppRun'
      vi.mocked(autoUpdater.downloadUpdate).mockResolvedValue([] as any)

      await ipc.invoke('updates:download')
      expect(autoUpdater.downloadUpdate).toHaveBeenCalled()
      expect(shell.openExternal).not.toHaveBeenCalled()

      if (origAppImage === undefined) {
        delete process.env.APPIMAGE
      } else {
        process.env.APPIMAGE = origAppImage
      }
    })

    it('opens GitHub releases for deb install', async () => {
      const origPlatform = process.platform
      const origAppImage = process.env.APPIMAGE
      delete process.env.APPIMAGE
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      vi.mocked(shell.openExternal).mockResolvedValue(undefined as any)

      await ipc.invoke('updates:download')
      expect(shell.openExternal).toHaveBeenCalledWith(
        'https://github.com/BaLaurent/agent-desktop/releases/latest',
      )
      expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()

      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
      if (origAppImage !== undefined) process.env.APPIMAGE = origAppImage
    })
  })

  describe('updates:install', () => {
    it('calls quitAndInstall', async () => {
      await ipc.invoke('updates:install')
      expect(autoUpdater.quitAndInstall).toHaveBeenCalled()
    })
  })

  describe('updates:getStatus', () => {
    it('returns idle status by default', async () => {
      const status = await ipc.invoke('updates:getStatus')
      expect(status).toEqual({ state: 'idle' })
    })
  })

  describe('initAutoUpdater', () => {
    it('configures autoDownload=false, suppresses logger, and registers event listeners', () => {
      const getWindow = vi.fn(() => null)
      initAutoUpdater(getWindow)

      expect(autoUpdater.autoDownload).toBe(false)
      expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
      expect(autoUpdater.logger).toBeNull()
      expect(autoUpdater.on).toHaveBeenCalledWith('checking-for-update', expect.any(Function))
      expect(autoUpdater.on).toHaveBeenCalledWith('update-available', expect.any(Function))
      expect(autoUpdater.on).toHaveBeenCalledWith('update-not-available', expect.any(Function))
      expect(autoUpdater.on).toHaveBeenCalledWith('download-progress', expect.any(Function))
      expect(autoUpdater.on).toHaveBeenCalledWith('update-downloaded', expect.any(Function))
      expect(autoUpdater.on).toHaveBeenCalledWith('error', expect.any(Function))
    })
  })

  describe('stopAutoUpdater', () => {
    it('does not throw when called', () => {
      expect(() => stopAutoUpdater()).not.toThrow()
    })
  })

  describe('checkForUpdates', () => {
    it('calls autoUpdater.checkForUpdates', () => {
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null as any)
      checkForUpdates()
      expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
    })
  })

  describe('installUpdate', () => {
    it('calls autoUpdater.quitAndInstall', () => {
      installUpdate()
      expect(autoUpdater.quitAndInstall).toHaveBeenCalled()
    })
  })
})
