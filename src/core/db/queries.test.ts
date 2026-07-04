import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import type { SqlJsAdapter } from './sqljs-adapter'
import {
  getDefaultFolderId,
  conversationExists,
  countConversations,
  getBackgroundSchedulerEnabled,
  getDefaultModel,
} from './queries'

let db: SqlJsAdapter

beforeEach(async () => {
  db = await createTestDb()
})

describe('getDefaultFolderId', () => {
  it('returns the id of the default folder created by schema/seed', () => {
    const id = getDefaultFolderId(db)
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
  })

  it('returns null when no default folder exists', async () => {
    ;(db as any).exec('DELETE FROM conversations')
    ;(db as any).exec('DELETE FROM folders')
    expect(getDefaultFolderId(db)).toBeNull()
  })
})

describe('conversationExists', () => {
  it('returns false for a non-existent conversation id', () => {
    expect(conversationExists(db, 999999)).toBe(false)
  })

  it('returns true after inserting a conversation', () => {
    const folderId = getDefaultFolderId(db)!
    const result = (db as any)
      .prepare("INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))")
      .run('Test', folderId, 'claude-sonnet-4-6')
    expect(conversationExists(db, result.lastInsertRowid as number)).toBe(true)
  })
})

describe('countConversations', () => {
  it('returns 0 when no conversations exist', async () => {
    ;(db as any).exec('DELETE FROM conversations')
    expect(countConversations(db)).toBe(0)
  })

  it('returns the correct count after insertions', () => {
    const folderId = getDefaultFolderId(db)!
    ;(db as any).prepare("INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))").run('A', folderId, 'claude-sonnet-4-6')
    ;(db as any).prepare("INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))").run('B', folderId, 'claude-sonnet-4-6')
    expect(countConversations(db)).toBe(2)
  })
})

describe('getBackgroundSchedulerEnabled', () => {
  it('returns false when setting is absent', () => {
    expect(getBackgroundSchedulerEnabled(db)).toBe(false)
  })

  it('returns true when setting is "true"', () => {
    ;(db as any).prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('scheduler_background_enabled', 'true', datetime('now'))").run()
    expect(getBackgroundSchedulerEnabled(db)).toBe(true)
  })

  it('returns false when setting is "false"', () => {
    ;(db as any).prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('scheduler_background_enabled', 'false', datetime('now'))").run()
    expect(getBackgroundSchedulerEnabled(db)).toBe(false)
  })
})

describe('getDefaultModel', () => {
  it('returns null when ai_model setting is absent', () => {
    ;(db as any).exec("DELETE FROM settings WHERE key = 'ai_model'")
    expect(getDefaultModel(db)).toBeNull()
  })

  it('returns the model string when set', () => {
    ;(db as any).prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('ai_model', 'claude-opus-4-6', datetime('now'))").run()
    expect(getDefaultModel(db)).toBe('claude-opus-4-6')
  })
})
