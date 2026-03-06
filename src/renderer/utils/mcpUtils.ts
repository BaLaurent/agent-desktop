import type { McpTransportType } from '../../shared/types'

export function parseMcpDisabledList(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export interface ParsedMcpConfig {
  name: string
  type?: McpTransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

const CONFIG_KEYS = new Set(['command', 'args', 'env', 'url', 'type', 'headers'])

export function parseMcpJson(raw: string): ParsedMcpConfig | string {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return 'Invalid JSON'
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'Expected a JSON object'

  const record = obj as Record<string, unknown>

  // Detect format
  let name = ''
  let config: Record<string, unknown>

  if ('mcpServers' in record && record.mcpServers && typeof record.mcpServers === 'object') {
    // Wrapped: { "mcpServers": { "name": { ... } } }
    const servers = record.mcpServers as Record<string, unknown>
    const firstKey = Object.keys(servers)[0]
    if (!firstKey) return 'No server found in mcpServers'
    const val = servers[firstKey]
    if (!val || typeof val !== 'object' || Array.isArray(val)) return 'Invalid server config'
    name = firstKey
    config = val as Record<string, unknown>
  } else if (Object.keys(record).some((k) => CONFIG_KEYS.has(k))) {
    // Ultra-naked: { "command": "...", ... }
    config = record
  } else {
    // Naked: { "name": { "command": "..." } }
    const firstKey = Object.keys(record)[0]
    if (!firstKey) return 'Empty JSON object'
    const val = record[firstKey]
    if (!val || typeof val !== 'object' || Array.isArray(val)) return 'Invalid server config'
    name = firstKey
    config = val as Record<string, unknown>
  }

  const result: ParsedMcpConfig = { name }

  if (typeof config.command === 'string') {
    result.command = config.command
    result.type = 'stdio'
    if (Array.isArray(config.args)) result.args = config.args.map(String)
    if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
      result.env = config.env as Record<string, string>
    }
  } else if (typeof config.url === 'string') {
    result.url = config.url
    result.type = config.type === 'sse' ? 'sse' : 'http'
    if (config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
      result.headers = config.headers as Record<string, string>
    }
  } else {
    return 'Config must have "command" (stdio) or "url" (http/sse)'
  }

  return result
}
