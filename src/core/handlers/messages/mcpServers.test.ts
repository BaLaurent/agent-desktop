import { describe, it, expect, beforeEach } from 'vitest'
import { homedir } from 'os'
import { createTestDb } from '../../__tests__/db-helper'
import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import {
  loadMcpServersFromDb,
  filterDisabledMcpServers,
  injectSchedulerMcp,
} from './mcpServers'

describe('mcpServers helpers', () => {
  let db: SqlJsAdapter

  beforeEach(async () => {
    db = await createTestDb()
  })

  // ── loadMcpServersFromDb ──────────────────────────────────────

  describe('loadMcpServersFromDb', () => {
    it('returns empty object when no servers are configured', () => {
      const result = loadMcpServersFromDb(db as any)
      expect(result).toEqual({})
    })

    it('returns stdio server with command, args, no env when env is empty', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 1)",
      ).run('my-tool', 'stdio', 'node', '["server.js"]', '{}')
      const result = loadMcpServersFromDb(db as any)
      expect(result['my-tool']).toEqual({ command: 'node', args: ['server.js'] })
    })

    it('includes env on stdio server when env has values', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 1)",
      ).run('env-tool', 'stdio', 'npx', '["--yes", "pkg"]', '{"TOKEN":"abc","PORT":"3000"}')
      const result = loadMcpServersFromDb(db as any)
      expect(result['env-tool']).toEqual({
        command: 'npx',
        args: ['--yes', 'pkg'],
        env: { TOKEN: 'abc', PORT: '3000' },
      })
    })

    it('expands a leading ~ in the stdio command and args at the spawn boundary', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 1)",
      ).run('tilde-tool', 'stdio', '~/bin/my-mcp', '["~/config.json", "--port", "3000"]', '{}')
      const result = loadMcpServersFromDb(db as any)
      expect(result['tilde-tool']).toEqual({
        command: `${homedir()}/bin/my-mcp`,
        args: [`${homedir()}/config.json`, '--port', '3000'],
      })
    })

    it('returns http server with url, no headers when headers is empty', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      ).run('remote', 'http', '', '[]', '{}', 'https://mcp.example.com/v1', '{}')
      const result = loadMcpServersFromDb(db as any)
      expect(result['remote']).toEqual({ type: 'http', url: 'https://mcp.example.com/v1' })
    })

    it('includes headers on http server when headers has values', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      ).run(
        'authed-remote',
        'http',
        '',
        '[]',
        '{}',
        'https://mcp.example.com/v1',
        '{"Authorization":"Bearer tok"}',
      )
      const result = loadMcpServersFromDb(db as any)
      expect(result['authed-remote']).toEqual({
        type: 'http',
        url: 'https://mcp.example.com/v1',
        headers: { Authorization: 'Bearer tok' },
      })
    })

    it('returns sse server with correct type', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      ).run('sse-srv', 'sse', '', '[]', '{}', 'https://sse.example.com/events', '{}')
      const result = loadMcpServersFromDb(db as any)
      const cfg = result['sse-srv'] as any
      expect(cfg.type).toBe('sse')
      expect(cfg.url).toBe('https://sse.example.com/events')
    })

    it('skips http server with null url', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, url, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)",
      ).run('no-url', 'http', '', '[]', '{}', null)
      const result = loadMcpServersFromDb(db as any)
      expect(result['no-url']).toBeUndefined()
    })

    it('omits disabled servers (enabled = 0)', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 0)",
      ).run('disabled-tool', 'stdio', 'npx', '["x"]', '{}')
      const result = loadMcpServersFromDb(db as any)
      expect(result['disabled-tool']).toBeUndefined()
    })

    it('treats null type as stdio', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, command, args, env, enabled) VALUES (?, ?, ?, ?, 1)",
      ).run('implicit-stdio', 'node', '["app.js"]', '{}')
      const result = loadMcpServersFromDb(db as any)
      const cfg = result['implicit-stdio'] as any
      expect(cfg.command).toBe('node')
      expect(cfg.type).toBeUndefined() // stdio entries have no `type` field
    })

    it('loads multiple servers independently', () => {
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 1)",
      ).run('alpha', 'stdio', 'node', '["a.js"]', '{}')
      db.prepare(
        "INSERT INTO mcp_servers (name, type, command, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      ).run('beta', 'http', '', '[]', '{}', 'https://beta.example.com/mcp', '{}')
      const result = loadMcpServersFromDb(db as any)
      expect(Object.keys(result)).toHaveLength(2)
      expect((result['alpha'] as any).command).toBe('node')
      expect((result['beta'] as any).type).toBe('http')
    })
  })

  // ── filterDisabledMcpServers ──────────────────────────────────

  describe('filterDisabledMcpServers', () => {
    const servers = {
      alpha: { command: 'node', args: [] as string[] },
      beta: { command: 'node', args: [] as string[] },
      gamma: { command: 'node', args: [] as string[] },
    }

    it('returns servers unchanged when disabledJson is undefined', () => {
      const result = filterDisabledMcpServers(servers, undefined)
      expect(result).toBe(servers) // same reference
    })

    it('returns servers unchanged when disabledJson is empty string', () => {
      const result = filterDisabledMcpServers(servers, '')
      expect(result).toBe(servers)
    })

    it('returns servers unchanged when disabled array is empty', () => {
      const result = filterDisabledMcpServers(servers, '[]')
      expect(result).toBe(servers)
    })

    it('removes disabled server from map', () => {
      const result = filterDisabledMcpServers(servers, JSON.stringify(['beta']))
      expect(result['alpha']).toBeDefined()
      expect(result['beta']).toBeUndefined()
      expect(result['gamma']).toBeDefined()
    })

    it('removes multiple disabled servers', () => {
      const result = filterDisabledMcpServers(servers, JSON.stringify(['alpha', 'gamma']))
      expect(result['alpha']).toBeUndefined()
      expect(result['gamma']).toBeUndefined()
      expect(result['beta']).toBeDefined()
    })

    it('handles non-array JSON gracefully (returns original)', () => {
      // safeJsonParse returns [] for non-array; disabled.length === 0 → original returned
      const result = filterDisabledMcpServers(servers, '"just-a-string"')
      expect(result).toBe(servers)
    })

    it('handles invalid JSON gracefully (returns original)', () => {
      const result = filterDisabledMcpServers(servers, '{bad}')
      expect(result).toBe(servers)
    })

    it('disabling all servers returns empty map', () => {
      const result = filterDisabledMcpServers(servers, JSON.stringify(['alpha', 'beta', 'gamma']))
      expect(Object.keys(result)).toHaveLength(0)
    })

    it('disabling unknown server name is a no-op', () => {
      const result = filterDisabledMcpServers(servers, JSON.stringify(['nonexistent']))
      expect(Object.keys(result)).toHaveLength(3)
    })
  })

  // ── injectSchedulerMcp ────────────────────────────────────────

  describe('injectSchedulerMcp', () => {
    it('injects scheduler when sdkBackend is claude-agent-sdk and callback returns config', () => {
      const servers: Record<string, unknown> = {}
      const cfg = { command: 'node', args: ['scheduler.js'] }
      injectSchedulerMcp(servers as any, 'claude-agent-sdk', 42, () => cfg)
      expect(servers['agent_scheduler']).toEqual(cfg)
    })

    it('does NOT inject when sdkBackend is pi', () => {
      const servers: Record<string, unknown> = {}
      injectSchedulerMcp(servers as any, 'pi', 42, () => ({ command: 'node', args: [] }))
      expect(servers['agent_scheduler']).toBeUndefined()
    })

    it('does NOT inject when getSchedulerMcpConfig is undefined', () => {
      const servers: Record<string, unknown> = {}
      injectSchedulerMcp(servers as any, 'claude-agent-sdk', 42, undefined)
      expect(servers['agent_scheduler']).toBeUndefined()
    })

    it('does NOT inject when callback returns null (unattended mode)', () => {
      const servers: Record<string, unknown> = {}
      injectSchedulerMcp(servers as any, 'claude-agent-sdk', 42, () => null)
      expect(servers['agent_scheduler']).toBeUndefined()
    })

    it('passes conversationId to the callback', () => {
      const servers: Record<string, unknown> = {}
      let receivedId: number | undefined
      injectSchedulerMcp(servers as any, 'claude-agent-sdk', 99, (id) => {
        receivedId = id
        return { command: 'node', args: [] }
      })
      expect(receivedId).toBe(99)
    })

    it('does not mutate existing servers', () => {
      const servers: Record<string, unknown> = { existing: { command: 'existing', args: [] } }
      injectSchedulerMcp(servers as any, 'claude-agent-sdk', 1, () => ({
        command: 'sched',
        args: [],
      }))
      expect(servers['existing']).toBeDefined()
      expect(servers['agent_scheduler']).toBeDefined()
    })
  })
})
