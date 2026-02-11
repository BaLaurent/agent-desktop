import { createTestDb } from '../__tests__/db-helper'
import { seedDefaults } from './seed'
import type Database from 'better-sqlite3'

describe('seedDefaults', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('seeds 9 default shortcuts', () => {
    const shortcuts = db.prepare('SELECT * FROM keyboard_shortcuts').all() as any[]
    expect(shortcuts).toHaveLength(9)
    const actions = shortcuts.map((s: any) => s.action)
    expect(actions).toContain('new_conversation')
    expect(actions).toContain('send_message')
    expect(actions).toContain('stop_generation')
    expect(actions).toContain('toggle_sidebar')
    expect(actions).toContain('toggle_panel')
    expect(actions).toContain('focus_search')
    expect(actions).toContain('settings')
    expect(actions).toContain('voice_input')
    expect(actions).toContain('cycle_permission_mode')
  })

  it('seeds default settings with camelCase keys', () => {
    const settings = db.prepare('SELECT * FROM settings').all() as { key: string; value: string }[]
    const map = Object.fromEntries(settings.map((s) => [s.key, s.value]))

    expect(map.sendOnEnter).toBe('true')
    expect(map.autoScroll).toBe('true')
    expect(map.notificationSounds).toBe('true')
    expect(map.minimizeToTray).toBe('false')
    expect(map.ai_model).toBe('claude-sonnet-4-5-20250929')
    expect(map.ai_permissionMode).toBe('bypassPermissions')
    expect(map.ai_tools).toBe('preset:claude_code')
    expect(map.hooks_cwdRestriction).toBe('true')
  })

  it('does not duplicate on second call', () => {
    seedDefaults(db)
    const shortcuts = db.prepare('SELECT * FROM keyboard_shortcuts').all()
    expect(shortcuts).toHaveLength(9)
  })
})
