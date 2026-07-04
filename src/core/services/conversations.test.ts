import { describe, it, expect, beforeEach } from 'vitest'
import { ConversationService } from './conversations'
import { createTestDb } from '../__tests__/db-helper'

describe('ConversationService.findLastUserConversationId', () => {
  let db: any
  let service: ConversationService

  beforeEach(async () => {
    db = await createTestDb()
    service = new ConversationService(db)
  })

  function insertUserMessage(conversationId: number, createdAt: string): void {
    db.prepare(
      `INSERT INTO messages (conversation_id, role, content, created_at, updated_at)
       VALUES (?, 'user', 'hello', ?, ?)`
    ).run(conversationId, createdAt, createdAt)
  }

  function insertAssistantMessage(conversationId: number, createdAt: string): void {
    db.prepare(
      `INSERT INTO messages (conversation_id, role, content, created_at, updated_at)
       VALUES (?, 'assistant', 'hi', ?, ?)`
    ).run(conversationId, createdAt, createdAt)
  }

  it('returns null when DB has no conversations', () => {
    expect(service.findLastUserConversationId()).toBeNull()
  })

  it('returns null when conversations have no user messages', () => {
    const conv = service.create('Only assistant')
    insertAssistantMessage(conv.id, '2024-01-01T00:00:00Z')
    expect(service.findLastUserConversationId()).toBeNull()
  })

  it('returns the conversation with the most recent user message', () => {
    const older = service.create('Older')
    const newer = service.create('Newer')
    insertUserMessage(older.id, '2024-01-01T00:00:00Z')
    insertUserMessage(newer.id, '2024-02-01T00:00:00Z')
    expect(service.findLastUserConversationId()).toBe(newer.id)
  })

  it('excludes IDs passed in excludeIds and falls back to next most recent', () => {
    const older = service.create('Older')
    const newer = service.create('Newer')
    insertUserMessage(older.id, '2024-01-01T00:00:00Z')
    insertUserMessage(newer.id, '2024-02-01T00:00:00Z')
    expect(service.findLastUserConversationId([newer.id])).toBe(older.id)
  })

  it('returns null when all candidates are excluded', () => {
    const conv = service.create('Only one')
    insertUserMessage(conv.id, '2024-01-01T00:00:00Z')
    expect(service.findLastUserConversationId([conv.id])).toBeNull()
  })

  it('ignores invalid excludeIds (0, negative, NaN)', () => {
    const conv = service.create('Real')
    insertUserMessage(conv.id, '2024-01-01T00:00:00Z')
    expect(service.findLastUserConversationId([0, -1, NaN])).toBe(conv.id)
  })

  it('remains eligible when conversation has cleared_at set', () => {
    const conv = service.create('Cleared')
    insertUserMessage(conv.id, '2024-01-01T00:00:00Z')
    db.prepare("UPDATE conversations SET cleared_at = '2024-06-01T00:00:00Z' WHERE id = ?").run(conv.id)
    expect(service.findLastUserConversationId()).toBe(conv.id)
  })

  it('picks the conversation with the latest user message even if an older conversation has a newer assistant message', () => {
    const a = service.create('A')
    const b = service.create('B')
    insertUserMessage(a.id, '2024-02-01T00:00:00Z')
    insertAssistantMessage(b.id, '2024-03-01T00:00:00Z')
    expect(service.findLastUserConversationId()).toBe(a.id)
  })
})

describe('ConversationService.markOpened / findLastOpenedConversationId', () => {
  let db: any
  let service: ConversationService

  beforeEach(async () => {
    db = await createTestDb()
    service = new ConversationService(db)
  })

  function setOpenedAt(id: number, timestamp: string): void {
    db.prepare('UPDATE conversations SET last_opened_at = ? WHERE id = ?').run(timestamp, id)
  }

  it('returns null when no conversation has last_opened_at set', () => {
    service.create('Fresh')
    expect(service.findLastOpenedConversationId()).toBeNull()
  })

  it('markOpened writes a non-null timestamp for the given conversation', () => {
    const a = service.create('A')
    service.markOpened(a.id)
    const row = db
      .prepare('SELECT last_opened_at FROM conversations WHERE id = ?')
      .get(a.id) as { last_opened_at: string | null }
    expect(row.last_opened_at).not.toBeNull()
  })

  it('findLastOpenedConversationId returns the conversation with the latest timestamp', () => {
    const a = service.create('A')
    const b = service.create('B')
    setOpenedAt(a.id, '2024-01-01 10:00:00')
    setOpenedAt(b.id, '2024-01-01 11:00:00')
    expect(service.findLastOpenedConversationId()).toBe(b.id)
  })

  it('excludes given IDs', () => {
    const a = service.create('A')
    const b = service.create('B')
    setOpenedAt(a.id, '2024-01-01 10:00:00')
    setOpenedAt(b.id, '2024-01-01 11:00:00')
    expect(service.findLastOpenedConversationId([b.id])).toBe(a.id)
  })

  it('returns null when all opened conversations are excluded', () => {
    const a = service.create('A')
    setOpenedAt(a.id, '2024-01-01 10:00:00')
    expect(service.findLastOpenedConversationId([a.id])).toBeNull()
  })

  it('ignores conversations never opened even if newly created', () => {
    const a = service.create('A')
    service.create('B-never-opened')
    setOpenedAt(a.id, '2024-01-01 10:00:00')
    expect(service.findLastOpenedConversationId()).toBe(a.id)
  })

  it('markOpened on non-existent id is a no-op (does not throw)', () => {
    expect(() => service.markOpened(99999)).not.toThrow()
    expect(service.findLastOpenedConversationId()).toBeNull()
  })
})
