import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the streaming module to avoid transitive Electron imports
vi.mock('../services/streaming', () => ({
  streamMessage: vi.fn().mockResolvedValue({ content: '', toolCalls: [], aborted: false, sessionId: null }),
  abortStream: vi.fn(),
  respondToApproval: vi.fn(),
  sendChunk: vi.fn(),
  notifyConversationUpdated: vi.fn(),
  injectApiKeyEnv: vi.fn().mockReturnValue(null),
}))

// Mock the anthropic SDK loader
vi.mock('../services/anthropic', () => ({
  loadAgentSDK: vi.fn().mockResolvedValue({
    query: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
    }),
  }),
}))

import { DispatchRegistry } from '../dispatch'
import { registerMessagesHandlers, buildMessageHistory, getAISettings, getSystemPrompt, saveMessage } from './messages'
import { createTestDb } from '../__tests__/db-helper'
import { noopHookRunner } from '../ports/hookRunner'
import type { MessagesHandlerOptions } from './messages'
import type { Broadcaster } from '../ports/broadcaster'
import { tmpdir } from 'os'
import { join } from 'path'

function createTestOptions(overrides?: Partial<MessagesHandlerOptions>): MessagesHandlerOptions {
  const broadcaster: Broadcaster = { broadcast: () => {} }
  return {
    broadcaster,
    hookRunner: noopHookRunner,
    sessionsBase: join(tmpdir(), 'agent-test-sessions'),
    ...overrides,
  }
}

describe('messages handlers', () => {
  let dispatch: DispatchRegistry
  let db: any

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    db = await createTestDb()
    registerMessagesHandlers(dispatch, db, createTestOptions())
  })

  // ─── Handler Registration ─────────────────────────────────

  it('registers messages:send handler', () => {
    expect(dispatch.has('messages:send')).toBe(true)
  })

  it('registers messages:compact handler', () => {
    expect(dispatch.has('messages:compact')).toBe(true)
  })

  it('registers messages:stop handler', () => {
    expect(dispatch.has('messages:stop')).toBe(true)
  })

  it('registers messages:respondToApproval handler', () => {
    expect(dispatch.has('messages:respondToApproval')).toBe(true)
  })

  it('registers messages:regenerate handler', () => {
    expect(dispatch.has('messages:regenerate')).toBe(true)
  })

  it('registers messages:edit handler', () => {
    expect(dispatch.has('messages:edit')).toBe(true)
  })

  it('registers conversations:generateTitle handler', () => {
    expect(dispatch.has('conversations:generateTitle')).toBe(true)
  })
})

describe('buildMessageHistory', () => {
  let db: any

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('returns empty array for conversation with no messages', () => {
    db.prepare('INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)').run('Test', new Date().toISOString(), new Date().toISOString())
    const result = buildMessageHistory(db, 1)
    expect(result).toEqual([])
  })

  it('returns messages in chronological order', () => {
    const now = new Date()
    db.prepare('INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)').run('Test', now.toISOString(), now.toISOString())

    const t1 = new Date(now.getTime() + 1000).toISOString()
    const t2 = new Date(now.getTime() + 2000).toISOString()
    db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(1, 'user', 'Hello', '[]', t1, t1)
    db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(1, 'assistant', 'Hi there', '[]', t2, t2)

    const result = buildMessageHistory(db, 1)
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('user')
    expect(result[0].content).toBe('Hello')
    expect(result[1].role).toBe('assistant')
    expect(result[1].content).toBe('Hi there')
  })

  it('respects cleared_at filter', () => {
    const now = new Date()
    const clearTime = new Date(now.getTime() + 1500)
    db.prepare('INSERT INTO conversations (title, cleared_at, created_at, updated_at) VALUES (?, ?, ?, ?)').run('Test', clearTime.toISOString(), now.toISOString(), now.toISOString())

    const t1 = new Date(now.getTime() + 1000).toISOString()
    const t2 = new Date(now.getTime() + 2000).toISOString()
    db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(1, 'user', 'Before clear', '[]', t1, t1)
    db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(1, 'user', 'After clear', '[]', t2, t2)

    const result = buildMessageHistory(db, 1)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('After clear')
  })

  it('prepends compact_summary when present', () => {
    const now = new Date().toISOString()
    db.prepare('INSERT INTO conversations (title, compact_summary, created_at, updated_at) VALUES (?, ?, ?, ?)').run('Test', 'Previous context', now, now)

    const t1 = new Date(Date.now() + 1000).toISOString()
    db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(1, 'user', 'New message', '[]', t1, t1)

    const result = buildMessageHistory(db, 1)
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('assistant')
    expect(result[0].content).toContain('[Previous conversation summary]')
    expect(result[0].content).toContain('Previous context')
    expect(result[1].content).toBe('New message')
  })

  it('respects limit parameter', () => {
    const now = new Date()
    db.prepare('INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)').run('Test', now.toISOString(), now.toISOString())

    for (let i = 0; i < 10; i++) {
      const t = new Date(now.getTime() + i * 1000).toISOString()
      db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(1, 'user', `Msg ${i}`, '[]', t, t)
    }

    const result = buildMessageHistory(db, 1, 3)
    expect(result).toHaveLength(3)
    // Should be the 3 most recent, in chronological order
    expect(result[0].content).toBe('Msg 7')
    expect(result[1].content).toBe('Msg 8')
    expect(result[2].content).toBe('Msg 9')
  })
})

describe('saveMessage', () => {
  let db: any

  beforeEach(async () => {
    db = await createTestDb()
    db.prepare('INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)').run('Test', new Date().toISOString(), new Date().toISOString())
  })

  it('persists a user message and returns it', () => {
    const msg = saveMessage(db, 1, 'user', 'Hello world')
    expect(msg.id).toBeDefined()
    expect(msg.conversation_id).toBe(1)
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('Hello world')
    expect(msg.attachments).toBe('[]')
    expect(msg.tool_calls).toBeNull()
  })

  it('persists an assistant message with tool calls', () => {
    const toolCalls = [{ id: 'tc1', name: 'test_tool', input: '{}' }]
    const msg = saveMessage(db, 1, 'assistant', 'Response', [], toolCalls as any)
    expect(msg.role).toBe('assistant')
    expect(msg.tool_calls).toBe(JSON.stringify(toolCalls))
  })

  it('persists attachments as JSON', () => {
    const attachments = [{ name: 'file.txt', path: '/tmp/file.txt', type: 'text/plain', size: 100 }]
    const msg = saveMessage(db, 1, 'user', 'With file', attachments as any)
    expect(JSON.parse(msg.attachments)).toEqual(attachments)
  })

  it('can be read back from the database', () => {
    saveMessage(db, 1, 'user', 'Persisted message')
    const row = db.prepare('SELECT content FROM messages WHERE conversation_id = 1').get()
    expect(row.content).toBe('Persisted message')
  })
})

describe('getAISettings', () => {
  let db: any

  beforeEach(async () => {
    db = await createTestDb()
    const now = new Date().toISOString()
    db.prepare('INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)').run('Test', now, now)
  })

  it('returns valid AISettings structure', () => {
    const settings = getAISettings(db, 1, { sessionsBase: join(tmpdir(), 'agent-test') })
    expect(settings).toBeDefined()
    expect(settings.sdkBackend).toBe('claude-agent-sdk')
    expect(settings.permissionMode).toBe('bypassPermissions')
    expect(settings.cwd).toBeDefined()
    expect(typeof settings.cwd).toBe('string')
  })

  it('picks up global settings', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'claude-opus-4-6')").run()
    const settings = getAISettings(db, 1, { sessionsBase: join(tmpdir(), 'agent-test') })
    expect(settings.model).toBe('claude-opus-4-6')
  })

  it('cascades folder overrides over global', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'claude-sonnet-4-6')").run()
    const now = new Date().toISOString()
    const result = db.prepare('INSERT INTO folders (name, position, created_at, updated_at, ai_overrides) VALUES (?, ?, ?, ?, ?)').run('Folder', 0, now, now, JSON.stringify({ ai_model: 'claude-opus-4-6' }))
    const folderId = result.lastInsertRowid as number
    db.prepare('UPDATE conversations SET folder_id = ? WHERE id = 1').run(folderId)

    const settings = getAISettings(db, 1, { sessionsBase: join(tmpdir(), 'agent-test') })
    expect(settings.model).toBe('claude-opus-4-6')
  })

  it('cascades conversation overrides over folder', () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'claude-sonnet-4-6')").run()
    const now = new Date().toISOString()
    const result = db.prepare('INSERT INTO folders (name, position, created_at, updated_at, ai_overrides) VALUES (?, ?, ?, ?, ?)').run('Folder', 0, now, now, JSON.stringify({ ai_model: 'claude-opus-4-6' }))
    const folderId = result.lastInsertRowid as number
    db.prepare('UPDATE conversations SET folder_id = ?, ai_overrides = ? WHERE id = 1').run(folderId, JSON.stringify({ ai_model: 'claude-haiku-4-5-20251001' }))

    const settings = getAISettings(db, 1, { sessionsBase: join(tmpdir(), 'agent-test') })
    expect(settings.model).toBe('claude-haiku-4-5-20251001')
  })

  it('returns default tools preset', () => {
    const settings = getAISettings(db, 1, { sessionsBase: join(tmpdir(), 'agent-test') })
    expect(settings.tools).toEqual({ type: 'preset', preset: 'claude_code' })
  })
})

describe('getSystemPrompt', () => {
  let db: any

  beforeEach(async () => {
    db = await createTestDb()
    const now = new Date().toISOString()
    db.prepare('INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)').run('Test', now, now)
  })

  it('includes CWD directive', async () => {
    const prompt = await getSystemPrompt(db, 1, '/home/user/project')
    expect(prompt).toContain('Your working directory is /home/user/project')
    expect(prompt).toContain('Use absolute paths for all file operations')
  })

  it('includes per-conversation system prompt', async () => {
    db.prepare('UPDATE conversations SET system_prompt = ? WHERE id = 1').run('Custom prompt')
    const prompt = await getSystemPrompt(db, 1, '/tmp')
    expect(prompt).toContain('Custom prompt')
    expect(prompt).toContain('Your working directory is /tmp')
  })

  it('cascades ai_defaultSystemPrompt from global settings', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_defaultSystemPrompt', 'Global system prompt')").run()
    const prompt = await getSystemPrompt(db, 1, '/tmp')
    expect(prompt).toContain('Global system prompt')
  })

  it('injects agent personality', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_personality', 'Be friendly')").run()
    const prompt = await getSystemPrompt(db, 1, '/tmp')
    expect(prompt).toContain('Personality: Be friendly')
  })

  it('injects agent language', async () => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('agent_language', 'French')").run()
    const prompt = await getSystemPrompt(db, 1, '/tmp')
    expect(prompt).toContain('Always respond in French')
  })
})
