import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './auth'
import type Database from 'better-sqlite3'

// Mock the anthropic module
vi.mock('./anthropic', () => ({
  loadAgentSDK: vi.fn(),
}))

// Mock the env module
vi.mock('../utils/env', () => ({
  findBinaryInPath: vi.fn(() => '/usr/local/bin/claude'),
  isAppImage: vi.fn(() => false),
}))

// Mock fs (sync methods used by auth.ts)
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}))

import * as fs from 'fs'
import { findBinaryInPath, isAppImage } from '../utils/env'

describe('Auth Service', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(() => {
    db = createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
    vi.clearAllMocks()
    // Default: credentials file exists
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(findBinaryInPath).mockReturnValue('/usr/local/bin/claude')
    vi.mocked(isAppImage).mockReturnValue(false)
  })

  afterEach(() => {
    db.close()
  })

  describe('auth:getStatus', () => {
    it('returns authenticated when SDK query succeeds with init message', async () => {
      const { loadAgentSDK } = await import('./anthropic')
      const mockQuery = async function* () {
        yield { type: 'system', subtype: 'init' }
      }
      vi.mocked(loadAgentSDK).mockResolvedValue({
        query: vi.fn().mockReturnValue(mockQuery()),
      } as any)

      const status = await ipc.invoke('auth:getStatus')
      expect(status.authenticated).toBe(true)
      expect(status.user).toEqual({ email: 'Claude User', name: 'Claude User' })
    })

    it('returns authenticated when SDK query succeeds with result message', async () => {
      const { loadAgentSDK } = await import('./anthropic')
      const mockQuery = async function* () {
        yield { type: 'result', is_error: false }
      }
      vi.mocked(loadAgentSDK).mockResolvedValue({
        query: vi.fn().mockReturnValue(mockQuery()),
      } as any)

      const status = await ipc.invoke('auth:getStatus')
      expect(status.authenticated).toBe(true)
      expect(status.user).toEqual({ email: 'Claude User', name: 'Claude User' })
    })

    it('returns not authenticated when SDK query fails with error result', async () => {
      const { loadAgentSDK } = await import('./anthropic')
      const mockQuery = async function* () {
        yield { type: 'result', is_error: true }
      }
      vi.mocked(loadAgentSDK).mockResolvedValue({
        query: vi.fn().mockReturnValue(mockQuery()),
      } as any)

      const status = await ipc.invoke('auth:getStatus')
      expect(status.authenticated).toBe(false)
      expect(status.user).toBeNull()
    })

    it('returns error and diagnostics when SDK throws error', async () => {
      const { loadAgentSDK } = await import('./anthropic')
      vi.mocked(loadAgentSDK).mockRejectedValue(new Error('SDK not available'))

      const status = await ipc.invoke('auth:getStatus')
      expect(status.authenticated).toBe(false)
      expect(status.user).toBeNull()
      expect(status.error).toContain('SDK not available')
      expect(status.diagnostics).toBeDefined()
      expect(status.diagnostics.sdkError).toBe('SDK not available')
      expect(status.diagnostics.claudeBinaryFound).toBe(true)
      expect(status.diagnostics.credentialsFileExists).toBe(true)
    })

    it('returns error when credentials file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const status = await ipc.invoke('auth:getStatus')
      expect(status.authenticated).toBe(false)
      expect(status.error).toContain('Credentials not found')
      expect(status.diagnostics).toBeDefined()
      expect(status.diagnostics.credentialsFileExists).toBe(false)
    })

    it('includes AppImage status in diagnostics', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(isAppImage).mockReturnValue(true)

      const status = await ipc.invoke('auth:getStatus')
      expect(status.diagnostics).toBeDefined()
      expect(status.diagnostics.isAppImage).toBe(true)
    })

    it('includes claude binary path in diagnostics', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(findBinaryInPath).mockReturnValue(null)

      const status = await ipc.invoke('auth:getStatus')
      expect(status.diagnostics).toBeDefined()
      expect(status.diagnostics.claudeBinaryFound).toBe(false)
      expect(status.diagnostics.claudeBinaryPath).toBeNull()
    })

    it('returns authenticated when SDK query yields nothing but succeeds', async () => {
      const { loadAgentSDK } = await import('./anthropic')
      const mockQuery = async function* () {
        // Empty generator - no messages
      }
      vi.mocked(loadAgentSDK).mockResolvedValue({
        query: vi.fn().mockReturnValue(mockQuery()),
      } as any)

      const status = await ipc.invoke('auth:getStatus')
      expect(status.authenticated).toBe(true)
      expect(status.user).toEqual({ email: 'Claude User', name: 'Claude User' })
    })
  })

  describe('auth:login', () => {
    it('returns authenticated status when already logged in', async () => {
      const { loadAgentSDK } = await import('./anthropic')
      const mockQuery = async function* () {
        yield { type: 'system', subtype: 'init' }
      }
      vi.mocked(loadAgentSDK).mockResolvedValue({
        query: vi.fn().mockReturnValue(mockQuery()),
      } as any)

      const status = await ipc.invoke('auth:login')
      expect(status.authenticated).toBe(true)
      expect(status.user).toEqual({ email: 'Claude User', name: 'Claude User' })
    })

    it('throws error with descriptive message when not logged in', async () => {
      const { loadAgentSDK } = await import('./anthropic')
      vi.mocked(loadAgentSDK).mockRejectedValue(new Error('Not authenticated'))

      await expect(ipc.invoke('auth:login')).rejects.toThrow(
        'Authentication failed: Not authenticated'
      )
    })

    it('throws error with credentials message when credentials missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await expect(ipc.invoke('auth:login')).rejects.toThrow(
        'Credentials not found'
      )
    })
  })

  describe('auth:logout', () => {
    it('returns not authenticated status', async () => {
      const status = await ipc.invoke('auth:logout')
      expect(status).toEqual({
        authenticated: false,
        user: null,
      })
    })
  })
})
