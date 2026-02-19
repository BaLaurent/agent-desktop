import { vi } from 'vitest'

// Must be at top level, before imports
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-agent'),
    commandLine: { appendSwitch: vi.fn() },
  },
}))

vi.mock('../index', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('./anthropic', () => ({
  loadAgentSDK: vi.fn(),
}))

vi.mock('./streaming', () => ({
  streamMessage: vi.fn().mockResolvedValue({ content: 'AI response', toolCalls: [], aborted: false }),
  abortStream: vi.fn(),
  injectApiKeyEnv: vi.fn(() => null),
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return { ...actual, mkdirSync: vi.fn() }
})

import { createTestDb } from '../__tests__/db-helper'

import {
  buildMessageHistory,
  getSystemPrompt,
  getAISettings,
  saveMessage,
  copyAttachmentsToSession,
} from './messages'
import type Database from 'better-sqlite3'

describe('Messages Service', () => {
  let db: Database.Database
  let convId: number

  beforeEach(() => {
    db = createTestDb()
    const conv = db.prepare("INSERT INTO conversations (title) VALUES ('Test Conv')").run()
    convId = conv.lastInsertRowid as number
  })

  afterEach(() => {
    db.close()
  })

  it('buildMessageHistory returns messages in chronological order', () => {
    db.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', 'first', '2025-01-01T00:00:00Z')").run(convId)
    db.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'assistant', 'second', '2025-01-01T00:00:01Z')").run(convId)
    db.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, 'user', 'third', '2025-01-01T00:00:02Z')").run(convId)

    const history = buildMessageHistory(db, convId)
    expect(history).toHaveLength(3)
    expect(history[0].content).toBe('first')
    expect(history[1].content).toBe('second')
    expect(history[2].content).toBe('third')
  })

  it('buildMessageHistory returns empty array for conversation with no messages', () => {
    const history = buildMessageHistory(db, convId)
    expect(history).toEqual([])
  })

  it('getSystemPrompt includes cwd directive', async () => {
    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('/tmp/test')
    expect(prompt).toContain('working directory')
  })

  it('getSystemPrompt uses conversation system_prompt when present', async () => {
    db.prepare('UPDATE conversations SET system_prompt = ? WHERE id = ?').run('Custom system prompt', convId)
    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('Custom system prompt')
  })

  it('getSystemPrompt falls back to global default system prompt', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_defaultSystemPrompt', 'Global default prompt')").run()
    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('Global default prompt')
  })

  it('getSystemPrompt uses folder ai_overrides for system prompt', async () => {
    const folder = db.prepare("INSERT INTO folders (name) VALUES ('Prompt Folder')").run()
    const folderId = folder.lastInsertRowid as number
    db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ ai_defaultSystemPrompt: 'Folder-level prompt' }),
      folderId
    )
    db.prepare('UPDATE conversations SET folder_id = ? WHERE id = ?').run(folderId, convId)

    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('Folder-level prompt')
  })

  it('getSystemPrompt cascade: conversation ai_overrides > folder ai_overrides > global', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_defaultSystemPrompt', 'Global prompt')").run()
    const folder = db.prepare("INSERT INTO folders (name) VALUES ('SP Folder')").run()
    const folderId = folder.lastInsertRowid as number
    db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ ai_defaultSystemPrompt: 'Folder prompt' }),
      folderId
    )
    db.prepare('UPDATE conversations SET folder_id = ?, ai_overrides = ? WHERE id = ?').run(
      folderId,
      JSON.stringify({ ai_defaultSystemPrompt: 'Conv prompt override' }),
      convId
    )

    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('Conv prompt override')
    expect(prompt).not.toContain('Folder prompt')
    expect(prompt).not.toContain('Global prompt')
  })

  it('getSystemPrompt: conversation system_prompt column beats ai_overrides cascade', async () => {
    const folder = db.prepare("INSERT INTO folders (name) VALUES ('Column Folder')").run()
    const folderId = folder.lastInsertRowid as number
    db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ ai_defaultSystemPrompt: 'Folder prompt' }),
      folderId
    )
    db.prepare('UPDATE conversations SET folder_id = ?, system_prompt = ? WHERE id = ?').run(
      folderId, 'Direct column prompt', convId
    )

    const prompt = await getSystemPrompt(db, convId, '/tmp/test')
    expect(prompt).toContain('Direct column prompt')
    expect(prompt).not.toContain('Folder prompt')
  })

  it('getAISettings returns defaults from seeded settings', () => {
    const settings = getAISettings(db, convId)
    expect(settings.model).toBe('claude-sonnet-4-5-20250929')
    expect(settings.maxTurns).toBe(50)
    expect(settings.permissionMode).toBe('bypassPermissions')
  })

  it('getAISettings parses tools preset correctly', () => {
    const settings = getAISettings(db, convId)
    expect(settings.tools).toEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('getAISettings returns MCP servers config', () => {
    // Insert an enabled MCP server
    db.prepare(
      "INSERT INTO mcp_servers (name, command, args, env, enabled) VALUES (?, ?, ?, ?, 1)"
    ).run('test-server', 'npx', '["test-mcp"]', '{"KEY":"val"}')

    const settings = getAISettings(db, convId)
    expect(settings.mcpServers).toBeDefined()
    expect(settings.mcpServers!['test-server']).toEqual({
      command: 'npx',
      args: ['test-mcp'],
      env: { KEY: 'val' },
    })
  })

  it('getAISettings returns HTTP MCP server config', () => {
    db.prepare(
      "INSERT INTO mcp_servers (name, type, command, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
    ).run('remote-api', 'http', '', '[]', '{}', 'https://mcp.example.com/api', '{"Authorization":"Bearer tok"}')

    const settings = getAISettings(db, convId)
    expect(settings.mcpServers).toBeDefined()
    const serverConfig = settings.mcpServers!['remote-api'] as any
    expect(serverConfig.type).toBe('http')
    expect(serverConfig.url).toBe('https://mcp.example.com/api')
    expect(serverConfig.headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('getAISettings returns SSE MCP server config', () => {
    db.prepare(
      "INSERT INTO mcp_servers (name, type, command, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
    ).run('sse-server', 'sse', '', '[]', '{}', 'https://sse.example.com/events', '{}')

    const settings = getAISettings(db, convId)
    const serverConfig = settings.mcpServers!['sse-server'] as any
    expect(serverConfig.type).toBe('sse')
    expect(serverConfig.url).toBe('https://sse.example.com/events')
  })

  it('getAISettings handles mixed stdio and http servers', () => {
    db.prepare(
      "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, 1)"
    ).run('stdio-server', 'stdio', 'npx', '["test"]', '{}')

    db.prepare(
      "INSERT INTO mcp_servers (name, type, command, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
    ).run('http-server', 'http', '', '[]', '{}', 'https://example.com/mcp', '{}')

    const settings = getAISettings(db, convId)
    expect(settings.mcpServers).toBeDefined()

    // stdio server
    const stdio = settings.mcpServers!['stdio-server'] as any
    expect(stdio.command).toBe('npx')
    expect(stdio.args).toEqual(['test'])

    // http server
    const http = settings.mcpServers!['http-server'] as any
    expect(http.type).toBe('http')
    expect(http.url).toBe('https://example.com/mcp')
  })

  it('getAISettings skips HTTP server with missing url', () => {
    db.prepare(
      "INSERT INTO mcp_servers (name, type, command, args, env, url, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)"
    ).run('broken-http', 'http', '', '[]', '{}', null)

    const settings = getAISettings(db, convId)
    expect(settings.mcpServers!['broken-http']).toBeUndefined()
  })

  it('getAISettings applies conversation ai_overrides', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'claude-sonnet-4-5-20250929')").run()
    db.prepare('UPDATE conversations SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ ai_model: 'claude-opus-4-6' }),
      convId
    )
    const settings = getAISettings(db, convId)
    expect(settings.model).toBe('claude-opus-4-6')
  })

  it('getAISettings applies folder ai_overrides', () => {
    const folder = db.prepare("INSERT INTO folders (name) VALUES ('Test Folder')").run()
    const folderId = folder.lastInsertRowid as number
    db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ ai_model: 'claude-haiku-4-5-20251001' }),
      folderId
    )
    db.prepare('UPDATE conversations SET folder_id = ? WHERE id = ?').run(folderId, convId)

    const settings = getAISettings(db, convId)
    expect(settings.model).toBe('claude-haiku-4-5-20251001')
  })

  it('getAISettings cascade: conversation > folder > global', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'claude-sonnet-4-5-20250929')").run()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_maxTurns', '5')").run()

    const folder = db.prepare("INSERT INTO folders (name) VALUES ('Cascade Folder')").run()
    const folderId = folder.lastInsertRowid as number
    db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ ai_model: 'claude-haiku-4-5-20251001', ai_maxTurns: '10' }),
      folderId
    )
    db.prepare('UPDATE conversations SET folder_id = ?, ai_overrides = ? WHERE id = ?').run(
      folderId,
      JSON.stringify({ ai_model: 'claude-opus-4-6' }),
      convId
    )

    const settings = getAISettings(db, convId)
    // Conversation overrides folder for model
    expect(settings.model).toBe('claude-opus-4-6')
    // Folder overrides global for maxTurns
    expect(settings.maxTurns).toBe(10)
  })

  it('getAISettings filters out disabled MCP servers per conversation', () => {
    db.prepare(
      "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, 'stdio', ?, ?, ?, 1)"
    ).run('keep-server', 'npx', '["test"]', '{}')
    db.prepare(
      "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, 'stdio', ?, ?, ?, 1)"
    ).run('drop-server', 'npx', '["test"]', '{}')
    db.prepare('UPDATE conversations SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ ai_mcpDisabled: '["drop-server"]' }),
      convId
    )
    const settings = getAISettings(db, convId)
    expect(settings.mcpServers!['keep-server']).toBeDefined()
    expect(settings.mcpServers!['drop-server']).toBeUndefined()
  })

  it('getAISettings returns all MCP servers when ai_mcpDisabled is absent', () => {
    db.prepare(
      "INSERT INTO mcp_servers (name, type, command, args, env, enabled) VALUES (?, 'stdio', ?, ?, ?, 1)"
    ).run('test-mcp-all', 'npx', '["test"]', '{}')
    const settings = getAISettings(db, convId)
    expect(settings.mcpServers!['test-mcp-all']).toBeDefined()
  })

  it('getAISettings returns cwdRestrictionEnabled true by default', () => {
    const settings = getAISettings(db, convId)
    expect(settings.cwdRestrictionEnabled).toBe(true)
  })

  it('getAISettings returns cwdRestrictionEnabled false when setting is false', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('hooks_cwdRestriction', 'false')").run()
    const settings = getAISettings(db, convId)
    expect(settings.cwdRestrictionEnabled).toBe(false)
  })

  it('getAISettings allows conversation override for cwdRestriction', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('hooks_cwdRestriction', 'true')").run()
    db.prepare('UPDATE conversations SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ hooks_cwdRestriction: 'false' }),
      convId
    )
    const settings = getAISettings(db, convId)
    expect(settings.cwdRestrictionEnabled).toBe(false)
  })

  it('getAISettings gracefully handles invalid JSON in ai_overrides', () => {
    db.prepare('UPDATE conversations SET ai_overrides = ? WHERE id = ?').run(
      '{invalid json',
      convId
    )
    // Should not throw, falls back to global defaults
    const settings = getAISettings(db, convId)
    expect(settings.model).toBe('claude-sonnet-4-5-20250929')
  })

  it('getAISettings returns skills off by default', () => {
    const settings = getAISettings(db, convId)
    expect(settings.skills).toBe('off')
  })

  it('getAISettings reads ai_skills from global settings', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_skills', 'user')").run()
    const settings = getAISettings(db, convId)
    expect(settings.skills).toBe('user')
  })

  it('getAISettings cascades ai_skills: conversation > folder > global', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_skills', 'off')").run()
    const folder = db.prepare("INSERT INTO folders (name) VALUES ('Skills Folder')").run()
    const folderId = folder.lastInsertRowid as number
    db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
      JSON.stringify({ ai_skills: 'user' }),
      folderId
    )
    db.prepare('UPDATE conversations SET folder_id = ?, ai_overrides = ? WHERE id = ?').run(
      folderId,
      JSON.stringify({ ai_skills: 'project' }),
      convId
    )
    const settings = getAISettings(db, convId)
    expect(settings.skills).toBe('project')
  })

  it('getAISettings returns skillsEnabled true by default', () => {
    const settings = getAISettings(db, convId)
    expect(settings.skillsEnabled).toBe(true)
  })

  it('getAISettings reads skillsEnabled from global settings', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_skillsEnabled', 'false')").run()
    const settings = getAISettings(db, convId)
    expect(settings.skillsEnabled).toBe(false)
  })

  it('getAISettings returns empty disabledSkills by default', () => {
    const settings = getAISettings(db, convId)
    expect(settings.disabledSkills).toEqual([])
  })

  it('getAISettings parses disabledSkills from settings', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_disabledSkills', ?)").run(
      JSON.stringify(['weather-wttr', 'godot-docs'])
    )
    const settings = getAISettings(db, convId)
    expect(settings.disabledSkills).toEqual(['weather-wttr', 'godot-docs'])
  })

  it('getAISettings supports skills=local', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_skills', 'local')").run()
    const settings = getAISettings(db, convId)
    expect(settings.skills).toBe('local')
  })

  it('saveMessage inserts and returns message with id', () => {
    const msg = saveMessage(db, convId, 'user', 'Hello world')
    expect(msg.id).toBeGreaterThan(0)
    expect(msg.conversation_id).toBe(convId)
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('Hello world')
    expect(msg.created_at).toBeDefined()

    // Verify it's in the DB
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id) as any
    expect(row.content).toBe('Hello world')
  })

  it('saveMessage persists tool_calls when provided', () => {
    const toolCalls = [
      { id: 'tool_1', name: 'Bash', input: '{"command":"npm test"}', output: 'All tests pass', status: 'done' as const },
      { id: 'tool_2', name: 'Read', input: '{"file_path":"/src/index.ts"}', output: 'const x = 1', status: 'done' as const },
    ]
    const msg = saveMessage(db, convId, 'assistant', 'Done!', [], toolCalls)

    expect(msg.tool_calls).not.toBeNull()
    const parsed = JSON.parse(msg.tool_calls!)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].name).toBe('Bash')
    expect(parsed[1].name).toBe('Read')

    // Verify in DB
    const row = db.prepare('SELECT tool_calls FROM messages WHERE id = ?').get(msg.id) as any
    expect(row.tool_calls).not.toBeNull()
    expect(JSON.parse(row.tool_calls)).toHaveLength(2)
  })

  it('saveMessage sets tool_calls to null when not provided', () => {
    const msg = saveMessage(db, convId, 'user', 'Hello')
    expect(msg.tool_calls).toBeNull()

    const row = db.prepare('SELECT tool_calls FROM messages WHERE id = ?').get(msg.id) as any
    expect(row.tool_calls).toBeNull()
  })

  it('saveMessage sets tool_calls to null for empty array', () => {
    const msg = saveMessage(db, convId, 'assistant', 'No tools', [], [])
    expect(msg.tool_calls).toBeNull()

    const row = db.prepare('SELECT tool_calls FROM messages WHERE id = ?').get(msg.id) as any
    expect(row.tool_calls).toBeNull()
  })

  describe('copyAttachmentsToSession', () => {
    const { promises: fsp } = require('fs')

    it('returns empty result for no attachments', async () => {
      const result = await copyAttachmentsToSession('/tmp/cwd', [])
      expect(result.copied).toEqual([])
      expect(result.contentSuffix).toBe('')
    })

    it('copies files and returns markdown links', async () => {
      const mockMkdir = vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined)
      const mockAccess = vi.spyOn(fsp, 'access').mockRejectedValue(new Error('ENOENT'))
      const mockCopyFile = vi.spyOn(fsp, 'copyFile').mockResolvedValue(undefined)

      const attachments = [
        { name: 'report.txt', path: '/home/user/report.txt', type: 'text/plain', size: 1024 },
        { name: 'data.csv', path: '/home/user/data.csv', type: 'text/csv', size: 2048 },
      ]

      const result = await copyAttachmentsToSession('/tmp/cwd', attachments)

      expect(mockMkdir).toHaveBeenCalledWith('/tmp/cwd/attachments', { recursive: true })
      expect(mockCopyFile).toHaveBeenCalledTimes(2)
      expect(mockCopyFile).toHaveBeenCalledWith('/home/user/report.txt', '/tmp/cwd/attachments/report.txt')
      expect(mockCopyFile).toHaveBeenCalledWith('/home/user/data.csv', '/tmp/cwd/attachments/data.csv')

      expect(result.copied).toHaveLength(2)
      expect(result.copied[0].path).toBe('/tmp/cwd/attachments/report.txt')
      expect(result.copied[1].path).toBe('/tmp/cwd/attachments/data.csv')

      expect(result.contentSuffix).toContain('[report.txt](/tmp/cwd/attachments/report.txt)')
      expect(result.contentSuffix).toContain('[data.csv](/tmp/cwd/attachments/data.csv)')

      mockMkdir.mockRestore()
      mockAccess.mockRestore()
      mockCopyFile.mockRestore()
    })

    it('deduplicates filenames on collision', async () => {
      const mockMkdir = vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined)
      const mockCopyFile = vi.spyOn(fsp, 'copyFile').mockResolvedValue(undefined)
      // First access succeeds (file exists), second rejects (slot free)
      const mockAccess = vi.spyOn(fsp, 'access')
        .mockResolvedValueOnce(undefined)  // photo.jpg exists
        .mockRejectedValueOnce(new Error('ENOENT'))  // photo_1.jpg free

      const attachments = [
        { name: 'photo.jpg', path: '/home/user/photo.jpg', type: 'image/jpeg', size: 5000 },
      ]

      const result = await copyAttachmentsToSession('/tmp/cwd', attachments)

      expect(result.copied[0].name).toBe('photo_1.jpg')
      expect(result.copied[0].path).toBe('/tmp/cwd/attachments/photo_1.jpg')
      expect(result.contentSuffix).toContain('[photo_1.jpg](/tmp/cwd/attachments/photo_1.jpg)')

      mockMkdir.mockRestore()
      mockAccess.mockRestore()
      mockCopyFile.mockRestore()
    })
  })

  describe('attachment links in message content', () => {
    it('messages:send augments content with attachment links', () => {
      // Simulate what the handler does: content + contentSuffix saved together
      const content = 'Analyse ce fichier'
      const suffix = '\n\n[report.txt](/tmp/cwd/attachments/report.txt)'
      const msg = saveMessage(db, convId, 'user', content + suffix)

      const history = buildMessageHistory(db, convId)
      expect(history[0].content).toContain('Analyse ce fichier')
      expect(history[0].content).toContain('[report.txt](/tmp/cwd/attachments/report.txt)')
    })

    it('messages without attachments have clean content', () => {
      saveMessage(db, convId, 'user', 'Hello world')
      const history = buildMessageHistory(db, convId)
      expect(history[0].content).toBe('Hello world')
      expect(history[0].content).not.toContain('[')
    })
  })
})
