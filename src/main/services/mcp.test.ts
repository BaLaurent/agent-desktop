import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './mcp'
import type Database from 'better-sqlite3'

describe('MCP Service', () => {
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

  describe('mcp:listServers', () => {
    it('returns empty array when no servers', async () => {
      const servers = await ipc.invoke('mcp:listServers')
      expect(servers).toEqual([])
    })

    it('returns servers with status derived from enabled field', async () => {
      db.prepare(
        'INSERT INTO mcp_servers (name, command, args, env, enabled) VALUES (?, ?, ?, ?, ?)'
      ).run('test-server', 'node', '[]', '{}', 1)

      db.prepare(
        'INSERT INTO mcp_servers (name, command, args, env, enabled) VALUES (?, ?, ?, ?, ?)'
      ).run('disabled-server', 'python', '[]', '{}', 0)

      const servers = (await ipc.invoke('mcp:listServers')) as any[]
      expect(servers).toHaveLength(2)
      expect(servers[0].status).toBe('configured')
      expect(servers[1].status).toBe('disabled')
    })
  })

  describe('mcp:addServer', () => {
    it('adds server with valid config', async () => {
      const server = await ipc.invoke('mcp:addServer', {
        name: 'test-server',
        command: 'node',
        args: ['index.js'],
        env: { NODE_ENV: 'production' },
      })

      expect((server as any).name).toBe('test-server')
      expect((server as any).command).toBe('node')
      expect((server as any).status).toBe('configured')
    })

    it('throws on empty command', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: '',
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server command must be a non-empty string')
    })

    it('throws on command with semicolon (shell injection)', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node; rm -rf /',
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server command contains dangerous characters')
    })

    it('throws on command with pipe (shell injection)', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node | malicious',
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server command contains dangerous characters')
    })

    it('throws on command with backticks (shell injection)', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node `whoami`',
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server command contains dangerous characters')
    })

    it('throws on command with dollar sign (shell injection)', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node $(evil)',
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server command contains dangerous characters')
    })

    it('throws on command with ampersand (shell injection)', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node & malicious',
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server command contains dangerous characters')
    })

    it('throws on command with redirect (shell injection)', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node > /tmp/evil',
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server command contains dangerous characters')
    })

    it('throws on empty name', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: '',
          command: 'node',
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server name must be a non-empty string')
    })

    it('throws on non-string name', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 123,
          command: 'node',
          args: [],
          env: {},
        } as any)
      ).rejects.toThrow('MCP server name must be a non-empty string')
    })

    it('throws on name with double underscores (SDK naming conflict)', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'my__server',
          command: 'node',
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server name must not contain double underscores')
    })

    it('throws on oversized command', async () => {
      const longCommand = 'a'.repeat(1025)
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: longCommand,
          args: [],
          env: {},
        })
      ).rejects.toThrow('MCP server command too long')
    })

    it('throws on non-array args', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node',
          args: 'not-an-array',
          env: {},
        } as any)
      ).rejects.toThrow('MCP server args must be an array')
    })

    it('throws on args containing non-strings', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node',
          args: ['valid', 123, 'also-valid'],
          env: {},
        } as any)
      ).rejects.toThrow('MCP server args must be an array of strings')
    })

    it('throws on non-object env', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node',
          args: [],
          env: 'not-an-object',
        } as any)
      ).rejects.toThrow('MCP server env must be a plain object')
    })

    it('throws on null env', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node',
          args: [],
          env: null,
        } as any)
      ).rejects.toThrow('MCP server env must be a plain object')
    })

    it('throws on array env', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node',
          args: [],
          env: [],
        } as any)
      ).rejects.toThrow('MCP server env must be a plain object')
    })

    it('throws on env with non-string values', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          command: 'node',
          args: [],
          env: { KEY: 123 },
        } as any)
      ).rejects.toThrow('MCP server env must contain only string keys and values')
    })
  })

  describe('mcp:addServer (http/sse)', () => {
    it('adds HTTP server with valid url', async () => {
      const server = await ipc.invoke('mcp:addServer', {
        name: 'remote-server',
        type: 'http',
        url: 'https://mcp.example.com/api',
        headers: { Authorization: 'Bearer tok' },
      })

      expect((server as any).name).toBe('remote-server')
      expect((server as any).type).toBe('http')
      expect((server as any).url).toBe('https://mcp.example.com/api')
      expect((server as any).status).toBe('configured')
    })

    it('adds SSE server', async () => {
      const server = await ipc.invoke('mcp:addServer', {
        name: 'sse-server',
        type: 'sse',
        url: 'https://sse.example.com/events',
      })

      expect((server as any).type).toBe('sse')
    })

    it('throws on invalid transport type', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          type: 'websocket',
          url: 'https://example.com',
        })
      ).rejects.toThrow('MCP server type must be one of')
    })

    it('throws on empty URL for http server', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          type: 'http',
          url: '',
        })
      ).rejects.toThrow('MCP server URL must be a non-empty string')
    })

    it('throws on missing URL for http server', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          type: 'http',
        })
      ).rejects.toThrow('MCP server URL must be a non-empty string')
    })

    it('throws on non-http URL protocol', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          type: 'http',
          url: 'ftp://example.com',
        })
      ).rejects.toThrow('MCP server URL must use http or https protocol')
    })

    it('throws on invalid URL format', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          type: 'http',
          url: 'not a url',
        })
      ).rejects.toThrow('MCP server URL is not a valid URL')
    })

    it('throws on URL too long', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2040)
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          type: 'http',
          url: longUrl,
        })
      ).rejects.toThrow('MCP server URL too long')
    })

    it('throws on non-object headers', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          type: 'http',
          url: 'https://example.com',
          headers: 'not-an-object',
        } as any)
      ).rejects.toThrow('MCP server headers must be a plain object')
    })

    it('throws on headers with non-string values', async () => {
      await expect(
        ipc.invoke('mcp:addServer', {
          name: 'test',
          type: 'http',
          url: 'https://example.com',
          headers: { key: 123 },
        } as any)
      ).rejects.toThrow('MCP server headers must contain only string keys and values')
    })
  })

  describe('mcp:updateServer', () => {
    it('updates server name', async () => {
      const result = db
        .prepare('INSERT INTO mcp_servers (name, command, args, env) VALUES (?, ?, ?, ?)')
        .run('old-name', 'node', '[]', '{}')

      await ipc.invoke('mcp:updateServer', result.lastInsertRowid, { name: 'new-name' })

      const server = db
        .prepare('SELECT * FROM mcp_servers WHERE id = ?')
        .get(result.lastInsertRowid) as any
      expect(server.name).toBe('new-name')
    })

    it('updates server command', async () => {
      const result = db
        .prepare('INSERT INTO mcp_servers (name, command, args, env) VALUES (?, ?, ?, ?)')
        .run('test', 'node', '[]', '{}')

      await ipc.invoke('mcp:updateServer', result.lastInsertRowid, { command: 'python' })

      const server = db
        .prepare('SELECT * FROM mcp_servers WHERE id = ?')
        .get(result.lastInsertRowid) as any
      expect(server.command).toBe('python')
    })

    it('throws on invalid id', async () => {
      await expect(ipc.invoke('mcp:updateServer', -1, { name: 'test' })).rejects.toThrow(
        'MCP server ID must be a positive integer'
      )
    })

    it('throws on dangerous command during update', async () => {
      const result = db
        .prepare('INSERT INTO mcp_servers (name, command, args, env) VALUES (?, ?, ?, ?)')
        .run('test', 'node', '[]', '{}')

      await expect(
        ipc.invoke('mcp:updateServer', result.lastInsertRowid, { command: 'node; rm -rf /' })
      ).rejects.toThrow('MCP server command contains dangerous characters')
    })

    it('updates server type and url', async () => {
      const result = db
        .prepare('INSERT INTO mcp_servers (name, command, args, env) VALUES (?, ?, ?, ?)')
        .run('test', 'node', '[]', '{}')

      await ipc.invoke('mcp:updateServer', result.lastInsertRowid, {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { 'X-Token': 'abc' },
      })

      const server = db
        .prepare('SELECT * FROM mcp_servers WHERE id = ?')
        .get(result.lastInsertRowid) as any
      expect(server.type).toBe('http')
      expect(server.url).toBe('https://example.com/mcp')
      expect(JSON.parse(server.headers)).toEqual({ 'X-Token': 'abc' })
    })

    it('throws on invalid URL during update', async () => {
      const result = db
        .prepare('INSERT INTO mcp_servers (name, command, args, env) VALUES (?, ?, ?, ?)')
        .run('test', 'node', '[]', '{}')

      await expect(
        ipc.invoke('mcp:updateServer', result.lastInsertRowid, { url: 'not-a-url' })
      ).rejects.toThrow('MCP server URL is not a valid URL')
    })

    it('does nothing when no fields provided', async () => {
      const result = db
        .prepare('INSERT INTO mcp_servers (name, command, args, env) VALUES (?, ?, ?, ?)')
        .run('test', 'node', '[]', '{}')

      await ipc.invoke('mcp:updateServer', result.lastInsertRowid, {})

      const server = db
        .prepare('SELECT * FROM mcp_servers WHERE id = ?')
        .get(result.lastInsertRowid) as any
      expect(server.name).toBe('test')
      expect(server.command).toBe('node')
    })
  })

  describe('mcp:removeServer', () => {
    it('removes server', async () => {
      const result = db
        .prepare('INSERT INTO mcp_servers (name, command, args, env) VALUES (?, ?, ?, ?)')
        .run('test', 'node', '[]', '{}')

      await ipc.invoke('mcp:removeServer', result.lastInsertRowid)

      const servers = await ipc.invoke('mcp:listServers')
      expect(servers).toHaveLength(0)
    })

    it('throws on invalid id', async () => {
      await expect(ipc.invoke('mcp:removeServer', 0)).rejects.toThrow(
        'MCP server ID must be a positive integer'
      )
    })
  })

  describe('mcp:toggleServer', () => {
    it('toggles enabled from 1 to 0', async () => {
      const result = db
        .prepare('INSERT INTO mcp_servers (name, command, args, env, enabled) VALUES (?, ?, ?, ?, ?)')
        .run('test', 'node', '[]', '{}', 1)

      await ipc.invoke('mcp:toggleServer', result.lastInsertRowid)

      const server = db
        .prepare('SELECT * FROM mcp_servers WHERE id = ?')
        .get(result.lastInsertRowid) as any
      expect(server.enabled).toBe(0)
    })

    it('toggles enabled from 0 to 1', async () => {
      const result = db
        .prepare('INSERT INTO mcp_servers (name, command, args, env, enabled) VALUES (?, ?, ?, ?, ?)')
        .run('test', 'node', '[]', '{}', 0)

      await ipc.invoke('mcp:toggleServer', result.lastInsertRowid)

      const server = db
        .prepare('SELECT * FROM mcp_servers WHERE id = ?')
        .get(result.lastInsertRowid) as any
      expect(server.enabled).toBe(1)
    })

    it('throws on invalid id', async () => {
      await expect(ipc.invoke('mcp:toggleServer', -1)).rejects.toThrow(
        'MCP server ID must be a positive integer'
      )
    })

    it('throws when server not found', async () => {
      await expect(ipc.invoke('mcp:toggleServer', 9999)).rejects.toThrow('Server 9999 not found')
    })
  })

  describe('mcp:testConnection', () => {
    it('returns failure for non-existent server', async () => {
      const result = (await ipc.invoke('mcp:testConnection', 9999)) as any
      expect(result.success).toBe(false)
      expect(result.output).toContain('Server 9999 not found')
    })

    it('returns failure for invalid id', async () => {
      const result = (await ipc.invoke('mcp:testConnection', -1)) as any
      expect(result.success).toBe(false)
      expect(result.output).toContain('MCP server ID must be a positive integer')
    })

    it('returns success for a command that exits cleanly', async () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 1)"
      ).run('echo-test', 'stdio', 'echo', '["hello"]', '{}')

      const server = db.prepare("SELECT id FROM mcp_servers WHERE name = 'echo-test'").get() as { id: number }
      const result = (await ipc.invoke('mcp:testConnection', server.id)) as any
      expect(result.success).toBe(true)
      expect(result.output).toContain('hello')
    }, 15000)

    it('returns failure for a command that does not exist', async () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 1)"
      ).run('bad-cmd', 'stdio', 'nonexistent-binary-xyz-12345', '[]', '{}')

      const server = db.prepare("SELECT id FROM mcp_servers WHERE name = 'bad-cmd'").get() as { id: number }
      const result = (await ipc.invoke('mcp:testConnection', server.id)) as any
      expect(result.success).toBe(false)
      expect(result.output).toContain('Failed to start')
    }, 15000)

    it('returns failure for http server with bad URL', async () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
      ).run('bad-http', 'http', '', '[]', '{}', 'http://127.0.0.1:1', '{}')

      const server = db.prepare("SELECT id FROM mcp_servers WHERE name = 'bad-http'").get() as { id: number }
      const result = (await ipc.invoke('mcp:testConnection', server.id)) as any
      expect(result.success).toBe(false)
      expect(result.output).toContain('Connection failed')
    }, 15000)

    it('returns failure for http server with no url', async () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, url, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)"
      ).run('no-url', 'http', '', '[]', '{}', null)

      const server = db.prepare("SELECT id FROM mcp_servers WHERE name = 'no-url'").get() as { id: number }
      const result = (await ipc.invoke('mcp:testConnection', server.id)) as any
      expect(result.success).toBe(false)
      expect(result.output).toContain('No URL configured')
    })

    it('output includes command line header for stdio', async () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 1)"
      ).run('header-test', 'stdio', 'echo', '["arg1", "arg two"]', '{}')

      const server = db.prepare("SELECT id FROM mcp_servers WHERE name = 'header-test'").get() as { id: number }
      const result = (await ipc.invoke('mcp:testConnection', server.id)) as any
      // Should show quoted args containing spaces
      expect(result.output).toContain('$ echo arg1 "arg two"')
    }, 15000)

    it('output includes URL header for http', async () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
      ).run('url-header', 'http', '', '[]', '{}', 'http://127.0.0.1:1', '{}')

      const server = db.prepare("SELECT id FROM mcp_servers WHERE name = 'url-header'").get() as { id: number }
      const result = (await ipc.invoke('mcp:testConnection', server.id)) as any
      expect(result.output).toContain('$ GET http://127.0.0.1:1')
    }, 15000)

    it('captures stderr output from failing process', async () => {
      const nodeArgs = JSON.stringify(['-e', 'console.error("test error"); process.exit(1)'])
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 1)"
      ).run('stderr-test', 'stdio', 'node', nodeArgs, '{}')

      const server = db.prepare("SELECT id FROM mcp_servers WHERE name = 'stderr-test'").get() as { id: number }
      const result = (await ipc.invoke('mcp:testConnection', server.id)) as any
      expect(result.success).toBe(false)
      expect(result.output).toContain('test error')
    }, 15000)
  })
})
