import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { spawn } from 'child_process'
import type { McpServer, McpServerConfig, McpTransportType, McpTestResult } from '../../shared/types'
import { safeJsonParse } from '../utils/json'

// Dangerous shell metacharacters that could be used for command injection
const DANGEROUS_CHARS = /[;&|`$(){}[\]<>!#~]/

const VALID_TRANSPORT_TYPES: McpTransportType[] = ['stdio', 'http', 'sse']

function validateMcpCommand(command: string): void {
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('MCP server command must be a non-empty string')
  }
  if (command.length > 1024) {
    throw new Error('MCP server command too long (max 1024 chars)')
  }
  if (DANGEROUS_CHARS.test(command)) {
    throw new Error('MCP server command contains dangerous characters')
  }
}

function validateMcpName(name: string): void {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('MCP server name must be a non-empty string')
  }
  if (name.length > 200) {
    throw new Error('MCP server name too long (max 200 chars)')
  }
  if (name.includes('__')) {
    throw new Error('MCP server name must not contain double underscores')
  }
}

function validateMcpArgs(args: unknown): void {
  if (!Array.isArray(args)) {
    throw new Error('MCP server args must be an array')
  }
  if (args.some((arg) => typeof arg !== 'string')) {
    throw new Error('MCP server args must be an array of strings')
  }
}

function validateMcpEnv(env: unknown): void {
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    throw new Error('MCP server env must be a plain object')
  }
  const envObj = env as Record<string, unknown>
  for (const [key, value] of Object.entries(envObj)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('MCP server env must contain only string keys and values')
    }
  }
}

function validateMcpId(id: unknown): void {
  if (typeof id !== 'number' || id <= 0 || !Number.isInteger(id)) {
    throw new Error('MCP server ID must be a positive integer')
  }
}

function validateMcpType(type: unknown): McpTransportType {
  if (typeof type !== 'string' || !VALID_TRANSPORT_TYPES.includes(type as McpTransportType)) {
    throw new Error(`MCP server type must be one of: ${VALID_TRANSPORT_TYPES.join(', ')}`)
  }
  return type as McpTransportType
}

function validateMcpUrl(url: unknown): void {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('MCP server URL must be a non-empty string')
  }
  if (url.length > 2048) {
    throw new Error('MCP server URL too long (max 2048 chars)')
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('MCP server URL must use http or https protocol')
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('protocol')) throw err
    throw new Error('MCP server URL is not a valid URL')
  }
}

function validateMcpHeaders(headers: unknown): void {
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
    throw new Error('MCP server headers must be a plain object')
  }
  const obj = headers as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('MCP server headers must contain only string keys and values')
    }
  }
}

const TEST_TIMEOUT_MS = 10_000
const MAX_OUTPUT_LEN = 4000

function testStdioConnection(server: McpServer): Promise<McpTestResult> {
  return new Promise((resolve) => {
    const args = safeJsonParse<string[]>(server.args, [])
    const env = safeJsonParse<Record<string, string>>(server.env, {})

    const cmdLine = [server.command, ...args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')
    let output = `$ ${cmdLine}\n`
    let resolved = false

    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn(server.command, args, {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      })
    } catch (err) {
      resolve({ success: false, output: `Failed to spawn: ${(err as Error).message}` })
      return
    }

    const appendOutput = (data: Buffer) => {
      if (output.length < MAX_OUTPUT_LEN) {
        output += data.toString()
      }
    }

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill()
        const truncated = output.length > MAX_OUTPUT_LEN
          ? output.slice(0, MAX_OUTPUT_LEN) + '\n...(truncated)'
          : output
        resolve({
          success: true,
          output: truncated || 'Process started successfully and is still running after 10s (no output)',
        })
      }
    }, TEST_TIMEOUT_MS)

    proc.stdout?.on('data', appendOutput)
    proc.stderr?.on('data', appendOutput)

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve({ success: false, output: `${output}Failed to start: ${err.message}` })
      }
    })

    proc.on('close', (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        const truncated = output.length > MAX_OUTPUT_LEN
          ? output.slice(0, MAX_OUTPUT_LEN) + '\n...(truncated)'
          : output
        resolve({
          success: code === 0,
          output: truncated || `Process exited with code ${code}`,
        })
      }
    })
  })
}

async function testHttpConnection(server: McpServer): Promise<McpTestResult> {
  const url = server.url
  if (!url) return { success: false, output: 'No URL configured' }

  const headers = safeJsonParse<Record<string, string>>(server.headers, {})

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeout)
    const body = await response.text().catch(() => '')
    const truncated = body.length > MAX_OUTPUT_LEN
      ? body.slice(0, MAX_OUTPUT_LEN) + '\n...(truncated)'
      : body

    return {
      success: response.ok,
      output: `$ GET ${url}\nHTTP ${response.status} ${response.statusText}\n${truncated}`,
    }
  } catch (err) {
    return {
      success: false,
      output: `$ GET ${url}\nConnection failed: ${(err as Error).message}`,
    }
  }
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('mcp:listServers', async () => {
    try {
      const rows = db.prepare('SELECT * FROM mcp_servers').all() as McpServer[]
      return rows.map((row) => ({
        ...row,
        type: row.type || 'stdio',
        status: row.enabled ? 'configured' : 'disabled',
      }))
    } catch (err) {
      throw new Error(`Failed to list MCP servers: ${(err as Error).message}`)
    }
  })

  ipcMain.handle('mcp:addServer', async (_event, config: McpServerConfig) => {
    try {
      validateMcpName(config.name)
      const transport = config.type ? validateMcpType(config.type) : 'stdio'

      if (transport === 'stdio') {
        // stdio requires command + args + env
        // Validate raw values first (null/undefined distinction matters for security tests)
        const cmd = config.command !== undefined ? config.command : ''
        const argsList = config.args !== undefined ? config.args : []
        const envObj = config.env !== undefined ? config.env : {}
        validateMcpCommand(cmd as string)
        validateMcpArgs(argsList)
        validateMcpEnv(envObj)

        const args = JSON.stringify(argsList)
        const env = JSON.stringify(envObj)
        const result = db
          .prepare(
            'INSERT INTO mcp_servers (name, type, command, args, env) VALUES (?, ?, ?, ?, ?)'
          )
          .run(config.name, 'stdio', config.command, args, env)
        const server = db
          .prepare('SELECT * FROM mcp_servers WHERE id = ?')
          .get(result.lastInsertRowid) as McpServer
        return { ...server, type: server.type || 'stdio', status: 'configured' as const }
      } else {
        // http/sse requires url, optional headers
        validateMcpUrl(config.url)
        if (config.headers) validateMcpHeaders(config.headers)

        const headers = JSON.stringify(config.headers || {})
        const result = db
          .prepare(
            'INSERT INTO mcp_servers (name, type, command, args, env, url, headers) VALUES (?, ?, ?, ?, ?, ?, ?)'
          )
          .run(config.name, transport, '', '[]', '{}', config.url, headers)
        const server = db
          .prepare('SELECT * FROM mcp_servers WHERE id = ?')
          .get(result.lastInsertRowid) as McpServer
        return { ...server, type: server.type || transport, status: 'configured' as const }
      }
    } catch (err) {
      throw new Error(`Failed to add MCP server: ${(err as Error).message}`)
    }
  })

  ipcMain.handle(
    'mcp:updateServer',
    async (_event, id: number, config: Partial<McpServerConfig>) => {
      try {
        // Validate ID
        validateMcpId(id)

        // Validate each field that is being updated
        if (config.name !== undefined) {
          validateMcpName(config.name)
        }
        if (config.type !== undefined) {
          validateMcpType(config.type)
        }
        if (config.command !== undefined) {
          validateMcpCommand(config.command)
        }
        if (config.args !== undefined) {
          validateMcpArgs(config.args)
        }
        if (config.env !== undefined) {
          validateMcpEnv(config.env)
        }
        if (config.url !== undefined) {
          validateMcpUrl(config.url)
        }
        if (config.headers !== undefined) {
          validateMcpHeaders(config.headers)
        }

        const fields: string[] = []
        const values: unknown[] = []
        if (config.name !== undefined) {
          fields.push('name = ?')
          values.push(config.name)
        }
        if (config.type !== undefined) {
          fields.push('type = ?')
          values.push(config.type)
        }
        if (config.command !== undefined) {
          fields.push('command = ?')
          values.push(config.command)
        }
        if (config.args !== undefined) {
          fields.push('args = ?')
          values.push(JSON.stringify(config.args))
        }
        if (config.env !== undefined) {
          fields.push('env = ?')
          values.push(JSON.stringify(config.env))
        }
        if (config.url !== undefined) {
          fields.push('url = ?')
          values.push(config.url)
        }
        if (config.headers !== undefined) {
          fields.push('headers = ?')
          values.push(JSON.stringify(config.headers))
        }
        if (fields.length === 0) return
        fields.push("updated_at = datetime('now')")
        values.push(id)
        db.prepare(`UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`).run(
          ...values
        )
      } catch (err) {
        throw new Error(`Failed to update MCP server: ${(err as Error).message}`)
      }
    }
  )

  ipcMain.handle('mcp:removeServer', async (_event, id: number) => {
    try {
      validateMcpId(id)
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
    } catch (err) {
      throw new Error(`Failed to remove MCP server: ${(err as Error).message}`)
    }
  })

  ipcMain.handle('mcp:toggleServer', async (_event, id: number) => {
    try {
      validateMcpId(id)
      const server = db
        .prepare('SELECT enabled FROM mcp_servers WHERE id = ?')
        .get(id) as { enabled: number } | undefined
      if (!server) throw new Error(`Server ${id} not found`)
      const newEnabled = server.enabled === 1 ? 0 : 1
      db.prepare(
        "UPDATE mcp_servers SET enabled = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(newEnabled, id)
    } catch (err) {
      throw new Error(`Failed to toggle MCP server: ${(err as Error).message}`)
    }
  })

  ipcMain.handle('mcp:testConnection', async (_event, id: number) => {
    try {
      validateMcpId(id)
      const server = db
        .prepare('SELECT * FROM mcp_servers WHERE id = ?')
        .get(id) as McpServer | undefined
      if (!server) throw new Error(`Server ${id} not found`)

      const transport = server.type || 'stdio'
      if (transport === 'stdio') {
        return await testStdioConnection(server)
      } else {
        return await testHttpConnection(server)
      }
    } catch (err) {
      return { success: false, output: `Test failed: ${(err as Error).message}` } as McpTestResult
    }
  })

}
