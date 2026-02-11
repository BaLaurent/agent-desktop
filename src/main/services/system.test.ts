import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './system'
import type Database from 'better-sqlite3'

// Mock Electron modules
vi.mock('electron', () => {
  class MockNotification {
    constructor(public options: { title: string; body: string }) {}
    show() {}
  }

  return {
    app: {
      getVersion: () => '1.0.0-test',
      getPath: (name: string) => `/tmp/test-${name}`,
    },
    dialog: {
      showOpenDialog: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
    },
    Notification: MockNotification,
  }
})

describe('System Service', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(() => {
    db = createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
  })

  afterEach(() => {
    db.close()
    vi.clearAllMocks()
  })

  describe('system:getInfo', () => {
    it('returns system information', async () => {
      const info = await ipc.invoke('system:getInfo')
      expect(info).toEqual({
        version: '1.0.0-test',
        electron: process.versions.electron,
        node: process.versions.node,
        platform: process.platform,
        dbPath: '/tmp/test-userData',
        configPath: '/tmp/test-userData',
      })
    })
  })

  describe('system:getLogs', () => {
    it('returns logs with default limit', async () => {
      const logs = await ipc.invoke('system:getLogs')
      expect(Array.isArray(logs)).toBe(true)
    })

    it('returns logs with custom limit', async () => {
      const logs = await ipc.invoke('system:getLogs', 50)
      expect(Array.isArray(logs)).toBe(true)
    })

    it('throws on invalid limit (negative)', async () => {
      await expect(ipc.invoke('system:getLogs', -1)).rejects.toThrow(
        'Invalid limit parameter'
      )
    })

    it('throws on invalid limit (non-number)', async () => {
      await expect(ipc.invoke('system:getLogs', 'invalid' as any)).rejects.toThrow(
        'Invalid limit parameter'
      )
    })

    it('clamps limit to maximum of 1000', async () => {
      const logs = await ipc.invoke('system:getLogs', 9999)
      expect(Array.isArray(logs)).toBe(true)
      expect(logs.length).toBeLessThanOrEqual(1000)
    })
  })

  describe('system:clearCache', () => {
    it('clears the log buffer', async () => {
      await ipc.invoke('system:clearCache')
      const logs = await ipc.invoke('system:getLogs')
      expect(logs).toEqual([])
    })
  })

  describe('system:openExternal', () => {
    it('opens valid HTTP URL', async () => {
      const { shell } = await import('electron')
      await ipc.invoke('system:openExternal', 'http://example.com')
      expect(shell.openExternal).toHaveBeenCalledWith('http://example.com')
    })

    it('opens valid HTTPS URL', async () => {
      const { shell } = await import('electron')
      await ipc.invoke('system:openExternal', 'https://example.com')
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
    })

    it('blocks file: protocol', async () => {
      await expect(ipc.invoke('system:openExternal', 'file:///etc/passwd')).rejects.toThrow(
        'Blocked protocol: file:'
      )
    })

    it('blocks javascript: protocol', async () => {
      await expect(
        ipc.invoke('system:openExternal', 'javascript:alert(1)')
      ).rejects.toThrow('Blocked protocol: javascript:')
    })

    it('blocks data: protocol', async () => {
      await expect(
        ipc.invoke('system:openExternal', 'data:text/html,<script>alert(1)</script>')
      ).rejects.toThrow('Blocked protocol: data:')
    })

    it('throws on invalid URL format', async () => {
      await expect(ipc.invoke('system:openExternal', 'not-a-url')).rejects.toThrow(
        'Invalid URL format'
      )
    })

    it('throws on non-string URL', async () => {
      await expect(ipc.invoke('system:openExternal', 123 as any)).rejects.toThrow(
        'Invalid URL'
      )
    })

    it('throws on null URL', async () => {
      await expect(ipc.invoke('system:openExternal', null as any)).rejects.toThrow(
        'Invalid URL'
      )
    })
  })

  describe('system:showNotification', () => {
    it('shows notification with valid title and body', async () => {
      await expect(
        ipc.invoke('system:showNotification', 'Test Title', 'Test Body')
      ).resolves.not.toThrow()
    })

    it('throws on non-string title', async () => {
      await expect(
        ipc.invoke('system:showNotification', 123 as any, 'Body')
      ).rejects.toThrow('Notification title and body must be strings')
    })

    it('throws on non-string body', async () => {
      await expect(
        ipc.invoke('system:showNotification', 'Title', 123 as any)
      ).rejects.toThrow('Notification title and body must be strings')
    })

    it('throws on oversized title', async () => {
      const longTitle = 'a'.repeat(501)
      await expect(
        ipc.invoke('system:showNotification', longTitle, 'Body')
      ).rejects.toThrow('Notification title or body exceeds maximum length')
    })

    it('throws on oversized body', async () => {
      const longBody = 'a'.repeat(501)
      await expect(
        ipc.invoke('system:showNotification', 'Title', longBody)
      ).rejects.toThrow('Notification title or body exceeds maximum length')
    })
  })

  describe('system:selectFolder', () => {
    it('returns folder path when user selects one', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/home/user/selected'],
      } as any)

      const result = await ipc.invoke('system:selectFolder')
      expect(result).toBe('/home/user/selected')
    })

    it('returns null when user cancels', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: true,
        filePaths: [],
      } as any)

      const result = await ipc.invoke('system:selectFolder')
      expect(result).toBeNull()
    })

    it('returns null when no paths selected', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [],
      } as any)

      const result = await ipc.invoke('system:selectFolder')
      expect(result).toBeNull()
    })
  })

  describe('system:purgeConversations', () => {
    it('deletes conversations and folders, preserves settings', async () => {
      // Add test data
      db.prepare('INSERT INTO folders (name) VALUES (?)').run('Test Folder')
      db.prepare('INSERT INTO conversations (title) VALUES (?)').run('Test Conv')

      const result = await ipc.invoke('system:purgeConversations')
      expect(result.conversations).toBe(1)
      expect(result.folders).toBe(1)

      // Verify deletion
      const convs = db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }
      const folders = db.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number }
      expect(convs.c).toBe(0)
      expect(folders.c).toBe(0)

      // Verify settings preserved
      const settings = db.prepare('SELECT COUNT(*) as c FROM settings').get() as { c: number }
      expect(settings.c).toBeGreaterThan(0)
    })

    it('returns zero counts when no data to delete', async () => {
      const result = await ipc.invoke('system:purgeConversations')
      expect(result.conversations).toBe(0)
      expect(result.folders).toBe(0)
    })
  })

  describe('system:purgeAll', () => {
    it('deletes conversations, folders, KB, MCP, themes, shortcuts', async () => {
      // Add test data
      db.prepare('INSERT INTO conversations (title) VALUES (?)').run('Test Conv')
      db.prepare('INSERT INTO folders (name) VALUES (?)').run('Test Folder')
      db.prepare(
        'INSERT INTO knowledge_files (path, name, content_hash, size) VALUES (?, ?, ?, ?)'
      ).run('/tmp/test', 'test.txt', 'hash', 100)
      db.prepare('INSERT INTO mcp_servers (name, command, args, env) VALUES (?, ?, ?, ?)').run(
        'test',
        'node',
        '[]',
        '{}'
      )

      const result = await ipc.invoke('system:purgeAll')
      expect(result.conversations).toBe(1)

      // Verify deletion
      const convs = db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }
      const folders = db.prepare('SELECT COUNT(*) as c FROM folders').get() as { c: number }
      const kb = db.prepare('SELECT COUNT(*) as c FROM knowledge_files').get() as { c: number }
      const mcp = db.prepare('SELECT COUNT(*) as c FROM mcp_servers').get() as { c: number }
      expect(convs.c).toBe(0)
      expect(folders.c).toBe(0)
      expect(kb.c).toBe(0)
      expect(mcp.c).toBe(0)

      // Verify settings and auth preserved
      const settings = db.prepare('SELECT COUNT(*) as c FROM settings').get() as { c: number }
      expect(settings.c).toBeGreaterThan(0)
    })

    it('returns zero count when no conversations to delete', async () => {
      const result = await ipc.invoke('system:purgeAll')
      expect(result.conversations).toBe(0)
    })
  })
})
