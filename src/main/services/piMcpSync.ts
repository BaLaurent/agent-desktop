import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type Database from 'better-sqlite3'
import type { McpServer } from '../../shared/types'
import { safeJsonParse } from '../utils/json'

interface PiMcpServerEntry {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export function buildPiMcpServers(
  db: Database.Database,
  disabledJson?: string
): Record<string, PiMcpServerEntry> {
  const rows = db.prepare('SELECT * FROM mcp_servers WHERE enabled = 1').all() as McpServer[]
  const disabled = new Set(safeJsonParse<string[]>(disabledJson || '[]', []))

  const result: Record<string, PiMcpServerEntry> = {}
  for (const row of rows) {
    if (disabled.has(row.name)) continue

    if (row.type === 'http' || row.type === 'sse') {
      if (!row.url) continue
      const entry: PiMcpServerEntry = { url: row.url }
      const headers = safeJsonParse<Record<string, string>>(row.headers, {})
      if (Object.keys(headers).length > 0) entry.headers = headers
      result[row.name] = entry
    } else {
      const entry: PiMcpServerEntry = {
        command: row.command,
        args: safeJsonParse<string[]>(row.args, []),
      }
      const env = safeJsonParse<Record<string, string>>(row.env, {})
      if (Object.keys(env).length > 0) entry.env = env
      result[row.name] = entry
    }
  }
  return result
}

export function isBackendPi(db: Database.Database): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_sdkBackend'").get() as
    | { value: string }
    | undefined
  return row?.value === 'pi'
}

async function writePiMcpJson(
  filePath: string,
  mcpServers: Record<string, PiMcpServerEntry>
): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify({ mcpServers }, null, 2) + '\n')
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export function syncPiMcpGlobal(db: Database.Database): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    try {
      if (!isBackendPi(db)) return
      const disabledRow = db
        .prepare("SELECT value FROM settings WHERE key = 'ai_mcpDisabled'")
        .get() as { value: string } | undefined
      const servers = buildPiMcpServers(db, disabledRow?.value)
      const filePath = join(homedir(), '.pi', 'agent', 'mcp.json')
      await writePiMcpJson(filePath, servers)
    } catch (err) {
      console.error('[piMcpSync] global sync failed:', err)
    }
  }, 300)
}

export async function syncPiMcpForProject(
  mcpServers: AISettings['mcpServers'],
  cwd?: string
): Promise<void> {
  try {
    // Always sync global-format servers to global path
    // Per-project: write .pi/mcp.json in cwd if provided
    if (!cwd) return
    const piServers: Record<string, PiMcpServerEntry> = {}
    if (mcpServers) {
      for (const [name, config] of Object.entries(mcpServers)) {
        if ('url' in config) {
          const entry: PiMcpServerEntry = { url: config.url }
          if (config.headers && Object.keys(config.headers).length > 0) entry.headers = config.headers
          piServers[name] = entry
        } else {
          const entry: PiMcpServerEntry = { command: config.command, args: config.args }
          if (config.env && Object.keys(config.env).length > 0) entry.env = config.env
          piServers[name] = entry
        }
      }
    }
    const filePath = join(cwd, '.pi', 'mcp.json')
    await writePiMcpJson(filePath, piServers)
  } catch (err) {
    console.error('[piMcpSync] project sync failed:', err)
  }
}

// Re-export for type use in syncPiMcpForProject parameter
import type { AISettings } from './streaming'
