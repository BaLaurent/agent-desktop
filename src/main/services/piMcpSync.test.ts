import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildPiMcpServers, isBackendPi, syncPiMcpGlobal, syncPiMcpForProject } from './piMcpSync'

// Mock fs.promises
const mockMkdir = vi.fn().mockResolvedValue(undefined)
const mockWriteFile = vi.fn().mockResolvedValue(undefined)
vi.mock('fs', () => ({
  promises: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}))

// Mock os.homedir
vi.mock('os', () => ({
  homedir: () => '/home/testuser',
}))

function createMockDb(
  servers: Array<{
    id: number
    name: string
    type?: string
    command?: string
    args?: string
    env?: string
    url?: string | null
    headers?: string
    enabled: number
  }>,
  settings: Record<string, string> = {}
) {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('mcp_servers WHERE enabled = 1')) {
        return { all: () => servers.filter((s) => s.enabled === 1) }
      }
      if (sql.includes("settings WHERE key =")) {
        // Extract key from SQL
        return {
          get: (key?: string) => {
            // Key comes from .get() parameter via ? binding, but our mock gets the raw SQL
            // Parse the key from the SQL string
            const match = sql.match(/key = '([^']+)'/)
            const lookupKey = match ? match[1] : key
            if (lookupKey && settings[lookupKey]) {
              return { value: settings[lookupKey] }
            }
            return undefined
          },
        }
      }
      return { all: () => [], get: () => undefined }
    }),
  } as unknown as import('better-sqlite3').Database
}

describe('piMcpSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('buildPiMcpServers', () => {
    it('returns only enabled servers', () => {
      const db = createMockDb([
        { id: 1, name: 'srv1', command: 'npx', args: '["foo"]', env: '{}', enabled: 1, url: null, headers: '{}' },
        { id: 2, name: 'srv2', command: 'node', args: '[]', env: '{}', enabled: 0, url: null, headers: '{}' },
      ])

      const result = buildPiMcpServers(db)
      expect(result).toEqual({
        srv1: { command: 'npx', args: ['foo'] },
      })
    })

    it('handles HTTP/SSE servers', () => {
      const db = createMockDb([
        {
          id: 1,
          name: 'http-srv',
          type: 'http',
          command: '',
          args: '[]',
          env: '{}',
          url: 'https://api.example.com/mcp',
          headers: '{"Authorization":"Bearer tok"}',
          enabled: 1,
        },
      ])

      const result = buildPiMcpServers(db)
      expect(result).toEqual({
        'http-srv': { url: 'https://api.example.com/mcp', headers: { Authorization: 'Bearer tok' } },
      })
    })

    it('excludes servers in ai_mcpDisabled', () => {
      const db = createMockDb([
        { id: 1, name: 'srv1', command: 'npx', args: '[]', env: '{}', enabled: 1, url: null, headers: '{}' },
        { id: 2, name: 'srv2', command: 'node', args: '[]', env: '{}', enabled: 1, url: null, headers: '{}' },
      ])

      const result = buildPiMcpServers(db, '["srv2"]')
      expect(result).toEqual({
        srv1: { command: 'npx', args: [] },
      })
    })

    it('includes env only when non-empty', () => {
      const db = createMockDb([
        {
          id: 1,
          name: 'srv1',
          command: 'npx',
          args: '["a"]',
          env: '{"KEY":"val"}',
          enabled: 1,
          url: null,
          headers: '{}',
        },
      ])

      const result = buildPiMcpServers(db)
      expect(result).toEqual({
        srv1: { command: 'npx', args: ['a'], env: { KEY: 'val' } },
      })
    })
  })

  describe('isBackendPi', () => {
    it('returns true when ai_sdkBackend is pi', () => {
      const db = createMockDb([], { ai_sdkBackend: 'pi' })
      expect(isBackendPi(db)).toBe(true)
    })

    it('returns false when ai_sdkBackend is not pi', () => {
      const db = createMockDb([], { ai_sdkBackend: 'claude-agent-sdk' })
      expect(isBackendPi(db)).toBe(false)
    })

    it('returns false when ai_sdkBackend is not set', () => {
      const db = createMockDb([], {})
      expect(isBackendPi(db)).toBe(false)
    })
  })

  describe('syncPiMcpGlobal', () => {
    it('skips when backend is not PI', async () => {
      const db = createMockDb([], { ai_sdkBackend: 'claude-agent-sdk' })
      syncPiMcpGlobal(db)
      await vi.advanceTimersByTimeAsync(300)
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('creates dir and writes correct JSON when PI', async () => {
      const db = createMockDb(
        [{ id: 1, name: 'test', command: 'npx', args: '["pkg"]', env: '{}', enabled: 1, url: null, headers: '{}' }],
        { ai_sdkBackend: 'pi' }
      )
      syncPiMcpGlobal(db)
      await vi.advanceTimersByTimeAsync(300)

      expect(mockMkdir).toHaveBeenCalledWith('/home/testuser/.pi/agent', { recursive: true })
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/testuser/.pi/agent/mcp.json',
        JSON.stringify({ mcpServers: { test: { command: 'npx', args: ['pkg'] } } }, null, 2) + '\n'
      )
    })

    it('debounces multiple rapid calls into single write', async () => {
      const db = createMockDb(
        [{ id: 1, name: 'test', command: 'npx', args: '[]', env: '{}', enabled: 1, url: null, headers: '{}' }],
        { ai_sdkBackend: 'pi' }
      )
      syncPiMcpGlobal(db)
      syncPiMcpGlobal(db)
      syncPiMcpGlobal(db)
      await vi.advanceTimersByTimeAsync(300)
      expect(mockWriteFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('syncPiMcpForProject', () => {
    it('writes .pi/mcp.json in given CWD', async () => {
      await syncPiMcpForProject(
        { myserver: { command: 'node', args: ['srv.js'], env: { TOKEN: 'abc' } } },
        '/home/user/project'
      )
      expect(mockMkdir).toHaveBeenCalledWith('/home/user/project/.pi', { recursive: true })
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/home/user/project/.pi/mcp.json',
        JSON.stringify(
          {
            mcpServers: {
              myserver: { command: 'node', args: ['srv.js'], env: { TOKEN: 'abc' } },
            },
          },
          null,
          2
        ) + '\n'
      )
    })

    it('skips when no cwd provided', async () => {
      await syncPiMcpForProject({ s: { command: 'x', args: [] } }, undefined)
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('handles HTTP servers in mcpServers dict', async () => {
      await syncPiMcpForProject(
        { api: { type: 'http' as const, url: 'https://api.test/mcp', headers: { Auth: 'Bearer x' } } },
        '/tmp/proj'
      )
      const written = JSON.parse(mockWriteFile.mock.calls[0][1].trim())
      expect(written.mcpServers.api).toEqual({ url: 'https://api.test/mcp', headers: { Auth: 'Bearer x' } })
    })
  })
})
