import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'

// Mock fs (synchronous methods used by singleInstance.ts)
vi.mock('fs', () => ({
  readlinkSync: vi.fn(() => { throw new Error('ENOENT') }),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => ''),
}))

// Mock os
vi.mock('os', () => ({
  hostname: vi.fn(() => 'myhost'),
}))

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/home/user/.config/agent-desktop'),
  },
}))

import * as fs from 'fs'
import * as os from 'os'
import { app } from 'electron'
import { killExistingInstances } from './singleInstance'

describe('killExistingInstances', () => {
  let killSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    killSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('does nothing when SingletonLock does not exist', () => {
    vi.mocked(fs.readlinkSync).mockImplementation(() => { throw new Error('ENOENT') })

    killExistingInstances()

    expect(killSpy).not.toHaveBeenCalled()
  })

  it('does nothing when hostname does not match', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('otherhost-1234')
    vi.mocked(os.hostname).mockReturnValue('myhost')

    killExistingInstances()

    expect(killSpy).not.toHaveBeenCalled()
  })

  it('does nothing when lock target is malformed (no dash)', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('malformed')

    killExistingInstances()

    expect(killSpy).not.toHaveBeenCalled()
  })

  it('does nothing when PID is not a valid number', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('myhost-notanumber')

    killExistingInstances()

    expect(killSpy).not.toHaveBeenCalled()
  })

  it('does nothing when PID is our own process', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue(`myhost-${process.pid}`)

    killExistingInstances()

    // Only signal 0 check, no actual kill
    expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGTERM')
    expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGKILL')
  })

  it('does nothing when the locked PID is already dead', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('myhost-9999')
    // signal 0 throws ESRCH — process doesn't exist
    killSpy.mockImplementation(() => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }) })

    killExistingInstances()

    // signal 0 was called but no SIGTERM/SIGKILL since isAlive returned false
    expect(killSpy).toHaveBeenCalledWith(9999, 0)
    expect(killSpy).not.toHaveBeenCalledWith(9999, 'SIGTERM')
  })

  it('sends SIGTERM and counts killed processes when SIGTERM succeeds', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('myhost-4242')
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

    let termSent = false
    killSpy.mockImplementation(((pid: number, signal?: string | number) => {
      if (signal === 0) {
        // After SIGTERM, the process dies
        if (termSent) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
        return true
      }
      if (signal === 'SIGTERM') {
        termSent = true
        return true
      }
      return true
    }) as typeof process.kill)

    killExistingInstances()

    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM')
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Killed 1 process(es)')
    )
  })

  it('falls back to SIGKILL when process survives SIGTERM', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('myhost-5555')
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

    let sigkillSent = false
    killSpy.mockImplementation(((pid: number, signal?: string | number) => {
      if (signal === 0) {
        // Process stays alive until SIGKILL
        if (sigkillSent) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
        return true
      }
      if (signal === 'SIGKILL') {
        sigkillSent = true
        return true
      }
      return true
    }) as typeof process.kill)

    // Speed up the test — mock Date.now to skip the busy-wait
    const realDateNow = Date.now
    let callCount = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++
      // First few calls: within deadline. After that: past deadline.
      return callCount < 5 ? realDateNow() : realDateNow() + 1000
    })

    killExistingInstances()

    expect(killSpy).toHaveBeenCalledWith(5555, 'SIGTERM')
    expect(killSpy).toHaveBeenCalledWith(5555, 'SIGKILL')

    vi.mocked(Date.now).mockRestore()
  })

  it('finds and kills child processes', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('myhost-1000')
    vi.mocked(fs.readdirSync).mockImplementation((p) => {
      if (p === '/proc') return ['1000', '1001', '1002', 'self', 'cpuinfo'] as unknown as ReturnType<typeof fs.readdirSync>
      throw new Error('ENOENT')
    })
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      const pStr = String(p)
      if (pStr === path.join('/proc', '1001', 'status')) return 'Name:\trenderer\nPPid:\t1000\n'
      if (pStr === path.join('/proc', '1002', 'status')) return 'Name:\tgpu\nPPid:\t1000\n'
      if (pStr === path.join('/proc', '1000', 'status')) return 'Name:\tagent\nPPid:\t1\n'
      throw new Error('ENOENT')
    })

    let termSent = false
    killSpy.mockImplementation(((pid: number, signal?: string | number) => {
      if (signal === 0) {
        if (termSent) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
        return true
      }
      if (signal === 'SIGTERM') {
        termSent = true
        return true
      }
      return true
    }) as typeof process.kill)

    killExistingInstances()

    expect(killSpy).toHaveBeenCalledWith(1000, 'SIGTERM')
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Killed 3 process(es)')
    )
  })

  it('handles EPERM gracefully when killing', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('myhost-7777')
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>)

    killSpy.mockImplementation(((pid: number, signal?: string | number) => {
      if (signal === 0) return true
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    }) as typeof process.kill)

    // Should not throw
    const realDateNow = Date.now
    let callCount = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++
      return callCount < 5 ? realDateNow() : realDateNow() + 1000
    })

    expect(() => killExistingInstances()).not.toThrow()

    vi.mocked(Date.now).mockRestore()
  })

  it('reads lock from correct userData path', () => {
    vi.mocked(app.getPath).mockReturnValue('/custom/data/path')
    vi.mocked(fs.readlinkSync).mockImplementation(() => { throw new Error('ENOENT') })

    killExistingInstances()

    expect(fs.readlinkSync).toHaveBeenCalledWith(
      path.join('/custom/data/path', 'SingletonLock')
    )
  })

  it('handles negative PID in lock file', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('myhost--1')

    killExistingInstances()

    expect(killSpy).not.toHaveBeenCalledWith(-1, expect.anything())
  })

  it('handles zero PID in lock file', () => {
    vi.mocked(fs.readlinkSync).mockReturnValue('myhost-0')

    killExistingInstances()

    expect(killSpy).not.toHaveBeenCalled()
  })
})
