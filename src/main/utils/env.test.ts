import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'

// Save original env
const originalEnv = { ...process.env }

// Mock fs (synchronous methods used by env.ts)
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  accessSync: vi.fn(() => { throw new Error('ENOENT') }),
  constants: { X_OK: 1, R_OK: 4 },
}))

import * as fs from 'fs'
import { enrichEnvironment, findBinaryInPath, isAppImage } from './env'

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
  })
})
