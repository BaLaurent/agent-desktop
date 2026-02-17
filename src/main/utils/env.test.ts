import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'

// Save original env
const originalEnv = { ...process.env }

// Mock fs (synchronous methods used by env.ts)
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  accessSync: vi.fn(() => { throw new Error('ENOENT') }),
  readdirSync: vi.fn(() => { throw new Error('ENOENT') }),
  constants: { X_OK: 1, R_OK: 4 },
}))

import * as fs from 'fs'
import { enrichEnvironment, findBinaryInPath, getSessionType, isAppImage } from './env'

describe('env utility', () => {
  beforeEach(() => {
    // Reset env to a known state before each test
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('isAppImage', () => {
    it('returns true when APPIMAGE env var is set', () => {
      process.env.APPIMAGE = '/path/to/Agent.AppImage'
      expect(isAppImage()).toBe(true)
    })

    it('returns false when APPIMAGE env var is not set', () => {
      delete process.env.APPIMAGE
      expect(isAppImage()).toBe(false)
    })
  })

  describe('findBinaryInPath', () => {
    it('returns absolute path directly if accessible', () => {
      vi.mocked(fs.accessSync).mockImplementation(() => undefined)
      const result = findBinaryInPath('/usr/bin/claude')
      expect(result).toBe('/usr/bin/claude')
      expect(fs.accessSync).toHaveBeenCalledWith('/usr/bin/claude', fs.constants.X_OK)
    })

    it('returns null for absolute path that is not executable', () => {
      vi.mocked(fs.accessSync).mockImplementation(() => { throw new Error('EACCES') })
      expect(findBinaryInPath('/usr/bin/claude')).toBeNull()
    })

    it('searches PATH directories for non-absolute name', () => {
      process.env.PATH = '/usr/bin:/usr/local/bin:/home/user/.local/bin'
      vi.mocked(fs.accessSync).mockImplementation((p) => {
        if (p === path.join('/usr/local/bin', 'claude')) return undefined
        throw new Error('ENOENT')
      })

      const result = findBinaryInPath('claude')
      expect(result).toBe(path.join('/usr/local/bin', 'claude'))
    })

    it('returns null when binary not found in any PATH dir', () => {
      process.env.PATH = '/usr/bin:/usr/local/bin'
      vi.mocked(fs.accessSync).mockImplementation(() => { throw new Error('ENOENT') })

      expect(findBinaryInPath('claude')).toBeNull()
    })

    it('returns null when PATH is empty', () => {
      process.env.PATH = ''
      expect(findBinaryInPath('claude')).toBeNull()
    })
  })

  describe('enrichEnvironment', () => {
    it('sets HOME if not set', () => {
      delete process.env.HOME
      enrichEnvironment()
      expect(process.env.HOME).toBeTruthy()
    })

    it('does not overwrite existing HOME', () => {
      process.env.HOME = '/custom/home'
      enrichEnvironment()
      expect(process.env.HOME).toBe('/custom/home')
    })

    it('sets CLAUDE_CONFIG_DIR if not set', () => {
      delete process.env.CLAUDE_CONFIG_DIR
      enrichEnvironment()
      expect(process.env.CLAUDE_CONFIG_DIR).toMatch(/\.claude$/)
    })

    it('does not overwrite existing CLAUDE_CONFIG_DIR', () => {
      process.env.CLAUDE_CONFIG_DIR = '/custom/config'
      enrichEnvironment()
      expect(process.env.CLAUDE_CONFIG_DIR).toBe('/custom/config')
    })

    it('appends existing directories to PATH', () => {
      const originalPath = process.env.PATH || ''
      // Mock accessSync to succeed for /usr/local/bin only
      vi.mocked(fs.accessSync).mockImplementation((p) => {
        if (p === '/usr/local/bin') return undefined
        throw new Error('ENOENT')
      })

      // Remove /usr/local/bin from PATH if present
      process.env.PATH = originalPath.split(':').filter(d => d !== '/usr/local/bin').join(':')

      enrichEnvironment()
      expect(process.env.PATH).toContain('/usr/local/bin')
    })

    it('does not duplicate existing PATH entries', () => {
      process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
      vi.mocked(fs.accessSync).mockImplementation(() => undefined)

      const pathBefore = process.env.PATH
      enrichEnvironment()
      // Count occurrences of /usr/local/bin
      const count = process.env.PATH!.split(':').filter(d => d === '/usr/local/bin').length
      expect(count).toBe(1)
    })

    it('is idempotent — calling twice produces same result', () => {
      vi.mocked(fs.accessSync).mockImplementation(() => { throw new Error('ENOENT') })
      enrichEnvironment()
      const pathAfterFirst = process.env.PATH
      enrichEnvironment()
      expect(process.env.PATH).toBe(pathAfterFirst)
    })

    it('cleans AppImage paths from LD_LIBRARY_PATH when APPIMAGE is set', () => {
      process.env.APPIMAGE = '/home/user/Agent.AppImage'
      process.env.APPDIR = '/tmp/.mount_AgentABCDEF'
      process.env.LD_LIBRARY_PATH = '/tmp/.mount_AgentABCDEF/usr/lib:/usr/lib/x86_64-linux-gnu:/tmp/.mount_AgentABCDEF/usr/lib/x86_64-linux-gnu'

      enrichEnvironment()

      expect(process.env.LD_LIBRARY_PATH).toBe('/usr/lib/x86_64-linux-gnu')
      expect(process.env.LD_LIBRARY_PATH_APPIMAGE).toContain('/tmp/.mount_AgentABCDEF')
    })

    it('sets LD_LIBRARY_PATH to undefined when all paths are AppImage paths', () => {
      process.env.APPIMAGE = '/home/user/Agent.AppImage'
      process.env.APPDIR = '/tmp/.mount_AgentABCDEF'
      process.env.LD_LIBRARY_PATH = '/tmp/.mount_AgentABCDEF/usr/lib'

      enrichEnvironment()

      expect(process.env.LD_LIBRARY_PATH).toBeUndefined()
    })

    it('does not modify LD_LIBRARY_PATH when not in AppImage', () => {
      delete process.env.APPIMAGE
      process.env.LD_LIBRARY_PATH = '/usr/lib:/custom/lib'

      enrichEnvironment()

      expect(process.env.LD_LIBRARY_PATH).toBe('/usr/lib:/custom/lib')
    })

    it('cleans LD_PRELOAD if it contains AppImage paths', () => {
      process.env.APPIMAGE = '/home/user/Agent.AppImage'
      process.env.APPDIR = '/tmp/.mount_AgentABCDEF'
      process.env.LD_PRELOAD = '/tmp/.mount_AgentABCDEF/usr/lib/libfoo.so:/usr/lib/libbar.so'

      enrichEnvironment()

      expect(process.env.LD_PRELOAD).toBe('/usr/lib/libbar.so')
      expect(process.env.LD_PRELOAD_APPIMAGE).toContain('/tmp/.mount_AgentABCDEF')
    })

    it('sets DBUS_SESSION_BUS_ADDRESS from XDG_RUNTIME_DIR/bus when missing', () => {
      delete process.env.DBUS_SESSION_BUS_ADDRESS
      process.env.XDG_RUNTIME_DIR = '/run/user/1000'
      vi.mocked(fs.accessSync).mockImplementation((p) => {
        if (p === '/run/user/1000/bus') return undefined
        throw new Error('ENOENT')
      })

      enrichEnvironment()

      expect(process.env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/1000/bus')
    })

    it('does not overwrite existing DBUS_SESSION_BUS_ADDRESS', () => {
      process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/custom/bus'
      process.env.XDG_RUNTIME_DIR = '/run/user/1000'

      enrichEnvironment()

      expect(process.env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/custom/bus')
    })

    it('warns when XDG_RUNTIME_DIR not available for D-Bus resolution', () => {
      delete process.env.DBUS_SESSION_BUS_ADDRESS
      delete process.env.XDG_RUNTIME_DIR
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      enrichEnvironment()

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('XDG_RUNTIME_DIR not set')
      )
      expect(process.env.DBUS_SESSION_BUS_ADDRESS).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('sets WAYLAND_DISPLAY from XDG_RUNTIME_DIR/wayland-* scan when missing', () => {
      delete process.env.WAYLAND_DISPLAY
      process.env.XDG_RUNTIME_DIR = '/run/user/1000'
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (p === '/run/user/1000') return ['bus', 'wayland-1', 'hypr', 'pulse'] as unknown as ReturnType<typeof fs.readdirSync>
        throw new Error('ENOENT')
      })

      enrichEnvironment()

      expect(process.env.WAYLAND_DISPLAY).toBe('wayland-1')
    })

    it('does not overwrite existing WAYLAND_DISPLAY', () => {
      process.env.WAYLAND_DISPLAY = 'wayland-0'
      process.env.XDG_RUNTIME_DIR = '/run/user/1000'
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        return ['wayland-1'] as unknown as ReturnType<typeof fs.readdirSync>
      })

      enrichEnvironment()

      expect(process.env.WAYLAND_DISPLAY).toBe('wayland-0')
    })

    it('sets HYPRLAND_INSTANCE_SIGNATURE from XDG_RUNTIME_DIR/hypr/ scan', () => {
      delete process.env.HYPRLAND_INSTANCE_SIGNATURE
      process.env.XDG_RUNTIME_DIR = '/run/user/1000'
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        if (p === path.join('/run/user/1000', 'hypr')) return ['abc123def'] as unknown as ReturnType<typeof fs.readdirSync>
        throw new Error('ENOENT')
      })

      enrichEnvironment()

      expect(process.env.HYPRLAND_INSTANCE_SIGNATURE).toBe('abc123def')
    })

    it('does not overwrite existing HYPRLAND_INSTANCE_SIGNATURE', () => {
      process.env.HYPRLAND_INSTANCE_SIGNATURE = 'existing_sig'
      process.env.XDG_RUNTIME_DIR = '/run/user/1000'
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        return ['new_sig'] as unknown as ReturnType<typeof fs.readdirSync>
      })

      enrichEnvironment()

      expect(process.env.HYPRLAND_INSTANCE_SIGNATURE).toBe('existing_sig')
    })
  })

  describe('getSessionType', () => {
    it('returns wayland when XDG_SESSION_TYPE is wayland', () => {
      process.env.XDG_SESSION_TYPE = 'wayland'
      expect(getSessionType()).toBe('wayland')
    })

    it('returns wayland when WAYLAND_DISPLAY is set without XDG_SESSION_TYPE', () => {
      delete process.env.XDG_SESSION_TYPE
      process.env.WAYLAND_DISPLAY = 'wayland-0'
      expect(getSessionType()).toBe('wayland')
    })

    it('returns wayland when HYPRLAND_INSTANCE_SIGNATURE is set (TTY-started Hyprland)', () => {
      delete process.env.XDG_SESSION_TYPE
      delete process.env.WAYLAND_DISPLAY
      process.env.HYPRLAND_INSTANCE_SIGNATURE = 'abc123'
      process.env.DISPLAY = ':1'
      expect(getSessionType()).toBe('wayland')
    })

    it('returns x11 when XDG_SESSION_TYPE is x11', () => {
      process.env.XDG_SESSION_TYPE = 'x11'
      delete process.env.WAYLAND_DISPLAY
      delete process.env.HYPRLAND_INSTANCE_SIGNATURE
      expect(getSessionType()).toBe('x11')
    })

    it('returns x11 when DISPLAY is set without XDG_SESSION_TYPE or WAYLAND_DISPLAY', () => {
      delete process.env.XDG_SESSION_TYPE
      delete process.env.WAYLAND_DISPLAY
      delete process.env.HYPRLAND_INSTANCE_SIGNATURE
      process.env.DISPLAY = ':0'
      expect(getSessionType()).toBe('x11')
    })

    it('returns unknown when no session variables are set', () => {
      delete process.env.XDG_SESSION_TYPE
      delete process.env.WAYLAND_DISPLAY
      delete process.env.HYPRLAND_INSTANCE_SIGNATURE
      delete process.env.DISPLAY
      expect(getSessionType()).toBe('unknown')
    })

    it('returns wayland when both WAYLAND_DISPLAY and DISPLAY are set (XWayland)', () => {
      delete process.env.XDG_SESSION_TYPE
      process.env.WAYLAND_DISPLAY = 'wayland-0'
      process.env.DISPLAY = ':0'
      expect(getSessionType()).toBe('wayland')
    })
  })
})
