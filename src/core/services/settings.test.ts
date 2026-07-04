import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { SettingsService } from './settings'
import { createTestDb } from '../__tests__/db-helper'

describe('SettingsService — lockedKeys', () => {
  let db: Database.Database
  let svc: SettingsService

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Database.Database
    svc = new SettingsService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('getLockedKeys is empty by default', () => {
    expect(svc.getLockedKeys()).toEqual([])
    expect(svc.isLocked('server_port')).toBe(false)
  })

  it('lockKey adds the key to the locked set', () => {
    svc.lockKey('server_port')
    expect(svc.isLocked('server_port')).toBe(true)
    expect(svc.getLockedKeys()).toContain('server_port')
  })

  it('set throws when the key is locked', () => {
    svc.lockKey('server_port')
    expect(() => svc.set('server_port', '4242')).toThrow(
      /Setting 'server_port' is locked by CLI override/,
    )
  })

  it('set still works for non-locked keys when others are locked', () => {
    svc.lockKey('server_port')
    expect(() => svc.set('theme', 'light')).not.toThrow()
    expect(svc.getAll().theme).toBe('light')
  })

  it('lockKey is idempotent and getLockedKeys is sorted', () => {
    svc.lockKey('server_accessMode')
    svc.lockKey('server_port')
    svc.lockKey('server_port')
    expect(svc.getLockedKeys()).toEqual(['server_accessMode', 'server_port'])
  })

  it('the lock-throw fires after the unknown-key check', () => {
    svc.lockKey('not_a_real_key')
    expect(() => svc.set('not_a_real_key', 'x')).toThrow(/Unknown setting key/)
  })
})
