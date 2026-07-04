import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb } from '../../__tests__/db-helper'
import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import {
  getFolderOverrides,
  cascadeStringKey,
  applyCascadeOnto,
  parseConvOverrides,
} from './cascade'

describe('cascade helpers', () => {
  let db: SqlJsAdapter

  beforeEach(async () => {
    db = await createTestDb()
  })

  // ── getFolderOverrides ────────────────────────────────────────

  describe('getFolderOverrides', () => {
    it('returns empty object when folder has no ai_overrides', () => {
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('Test')").run()
      const result = getFolderOverrides(db as any, folder.lastInsertRowid as number)
      expect(result).toEqual({})
    })

    it('parses valid JSON from ai_overrides', () => {
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('Parsed')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
        JSON.stringify({ ai_model: 'claude-opus-4' }),
        folderId,
      )
      const result = getFolderOverrides(db as any, folderId)
      expect(result).toEqual({ ai_model: 'claude-opus-4' })
    })

    it('returns empty object when ai_overrides is null', () => {
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('NullOv')").run()
      const result = getFolderOverrides(db as any, folder.lastInsertRowid as number)
      expect(result).toEqual({})
    })

    it('returns empty object when ai_overrides is invalid JSON', () => {
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('BadJSON')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run('{invalid', folderId)
      const result = getFolderOverrides(db as any, folderId)
      expect(result).toEqual({})
    })
  })

  // ── cascadeStringKey ──────────────────────────────────────────

  describe('cascadeStringKey', () => {
    it('returns conversation override when present', () => {
      const result = cascadeStringKey(
        db as any,
        'ai_model',
        { ai_model: 'conv-model' },
        null,
      )
      expect(result).toBe('conv-model')
    })

    it('falls through to folder when conv override is absent', () => {
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('FolderKey')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
        JSON.stringify({ ai_model: 'folder-model' }),
        folderId,
      )
      const result = cascadeStringKey(db as any, 'ai_model', {}, folderId)
      expect(result).toBe('folder-model')
    })

    it('falls through to global settings when conv and folder are absent', () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'global-model')").run()
      const result = cascadeStringKey(db as any, 'ai_model', {}, null)
      expect(result).toBe('global-model')
    })

    it('returns undefined when no level has a value', () => {
      const result = cascadeStringKey(db as any, 'nonexistent_key', {}, null)
      expect(result).toBeUndefined()
    })

    it('conv override wins over folder and global', () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'global-model')").run()
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('CascadeWin')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
        JSON.stringify({ ai_model: 'folder-model' }),
        folderId,
      )
      const result = cascadeStringKey(
        db as any,
        'ai_model',
        { ai_model: 'conv-winner' },
        folderId,
      )
      expect(result).toBe('conv-winner')
    })

    it('folder override wins over global', () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'global-model')").run()
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('FolderWin')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
        JSON.stringify({ ai_model: 'folder-winner' }),
        folderId,
      )
      const result = cascadeStringKey(db as any, 'ai_model', {}, folderId)
      expect(result).toBe('folder-winner')
    })

    it('skips folder lookup when folderId is null', () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_model', 'global-only')").run()
      const result = cascadeStringKey(db as any, 'ai_model', null, null)
      expect(result).toBe('global-only')
    })

    it('skips global lookup when folder has value', () => {
      // No global value
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('FolderOnly')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
        JSON.stringify({ ai_model: 'only-in-folder' }),
        folderId,
      )
      const result = cascadeStringKey(db as any, 'ai_model', {}, folderId)
      expect(result).toBe('only-in-folder')
    })
  })

  // ── applyCascadeOnto ──────────────────────────────────────────

  describe('applyCascadeOnto', () => {
    it('applies folder overrides onto the map', () => {
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('Apply')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
        JSON.stringify({ ai_model: 'folder-set' }),
        folderId,
      )
      const map: Record<string, string> = { ai_model: 'original' }
      applyCascadeOnto(map, db as any, folderId, null)
      expect(map['ai_model']).toBe('folder-set')
    })

    it('applies conversation overrides on top of folder overrides', () => {
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('ApplyConv')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
        JSON.stringify({ ai_model: 'folder-val' }),
        folderId,
      )
      const map: Record<string, string> = { ai_model: 'global' }
      applyCascadeOnto(map, db as any, folderId, JSON.stringify({ ai_model: 'conv-val' }))
      expect(map['ai_model']).toBe('conv-val')
    })

    it('does not overwrite with empty string', () => {
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('EmptySkip')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
        JSON.stringify({ ai_model: '' }),
        folderId,
      )
      const map: Record<string, string> = { ai_model: 'original' }
      applyCascadeOnto(map, db as any, folderId, null)
      expect(map['ai_model']).toBe('original')
    })

    it('does nothing when folderId is null and convOverridesRaw is null', () => {
      const map: Record<string, string> = { ai_model: 'unchanged' }
      applyCascadeOnto(map, db as any, null, null)
      expect(map['ai_model']).toBe('unchanged')
    })

    it('handles invalid JSON in convOverridesRaw gracefully', () => {
      const map: Record<string, string> = { ai_model: 'safe' }
      applyCascadeOnto(map, db as any, null, '{bad json}')
      // safeJsonParse should return {} — map is unchanged
      expect(map['ai_model']).toBe('safe')
    })

    it('merges multiple keys from conv overrides', () => {
      const map: Record<string, string> = {}
      applyCascadeOnto(
        map,
        db as any,
        null,
        JSON.stringify({ ai_model: 'a', ai_maxTurns: '20' }),
      )
      expect(map['ai_model']).toBe('a')
      expect(map['ai_maxTurns']).toBe('20')
    })

    it('folder keys not in conv overrides are preserved after conv override pass', () => {
      const folder = db.prepare("INSERT INTO folders (name) VALUES ('PreserveFolder')").run()
      const folderId = folder.lastInsertRowid as number
      db.prepare('UPDATE folders SET ai_overrides = ? WHERE id = ?').run(
        JSON.stringify({ ai_maxTurns: '15' }),
        folderId,
      )
      const map: Record<string, string> = {}
      applyCascadeOnto(
        map,
        db as any,
        folderId,
        JSON.stringify({ ai_model: 'conv-model' }),
      )
      // Both values should be in the map — folder's maxTurns + conv's model
      expect(map['ai_maxTurns']).toBe('15')
      expect(map['ai_model']).toBe('conv-model')
    })
  })

  // ── parseConvOverrides ────────────────────────────────────────

  describe('parseConvOverrides', () => {
    it('returns empty object for null input', () => {
      expect(parseConvOverrides(null)).toEqual({})
    })

    it('returns empty object for undefined input', () => {
      expect(parseConvOverrides(undefined)).toEqual({})
    })

    it('parses valid JSON string', () => {
      const result = parseConvOverrides(JSON.stringify({ ai_model: 'test' }))
      expect(result).toEqual({ ai_model: 'test' })
    })

    it('returns empty object for invalid JSON', () => {
      const result = parseConvOverrides('{bad}')
      expect(result).toEqual({})
    })

    it('returns empty object for empty string', () => {
      const result = parseConvOverrides('')
      expect(result).toEqual({})
    })
  })
})
