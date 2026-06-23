import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../../main/__tests__/db-helper'
import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import { getAgentDirectives } from './knowledgeBase'

describe('getAgentDirectives.name', () => {
  let db: SqlJsAdapter

  beforeEach(async () => {
    db = await createTestDb()
  })

  it('returns the cascaded agent_name from the conversation override', () => {
    const conv = db
      .prepare("INSERT INTO conversations (title, ai_overrides, updated_at) VALUES ('T', ?, datetime('now'))")
      .run(JSON.stringify({ agent_name: 'Clawd' }))
    const result = getAgentDirectives(db, conv.lastInsertRowid as number)
    expect(result.name).toBe('Clawd')
  })

  it('returns undefined name when agent_name is not set anywhere', () => {
    const conv = db
      .prepare("INSERT INTO conversations (title, updated_at) VALUES ('T', datetime('now'))")
      .run()
    const result = getAgentDirectives(db, conv.lastInsertRowid as number)
    expect(result.name).toBeUndefined()
  })
})
