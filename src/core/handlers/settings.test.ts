import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerSettingsHandlers } from './settings'
import { SettingsService } from '../services/settings'
import { createTestDb } from '../../main/__tests__/db-helper'

describe('settings handlers', () => {
  let dispatch: DispatchRegistry

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerSettingsHandlers(dispatch, db as any)
  })

  it('registers settings:get handler', () => {
    expect(dispatch.has('settings:get')).toBe(true)
  })

  it('registers settings:set handler', () => {
    expect(dispatch.has('settings:set')).toBe(true)
  })

  it('registers settings:getLocked handler', () => {
    expect(dispatch.has('settings:getLocked')).toBe(true)
  })

  it('settings:get returns all settings', async () => {
    const get = dispatch.get('settings:get')!
    const result = await get() as Record<string, string>
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('settings:set persists a value', async () => {
    const set = dispatch.get('settings:set')!
    const get = dispatch.get('settings:get')!
    await set('theme', 'dark')
    const all = await get() as Record<string, string>
    expect(all['theme']).toBe('dark')
  })

  it('settings:getLocked returns [] when no key is locked', async () => {
    const getLocked = dispatch.get('settings:getLocked')!
    const result = await getLocked() as string[]
    expect(result).toEqual([])
  })
})

describe('settings handlers — shared service & locks', () => {
  it('settings:set on a locked key fails through the dispatch boundary', async () => {
    const dispatch = new DispatchRegistry()
    const db = await createTestDb()
    const shared = new SettingsService(db as any)
    shared.lockKey('server_port')
    registerSettingsHandlers(dispatch, db as any, shared)

    const set = dispatch.get('settings:set')!
    await expect(set('server_port', '4242')).rejects.toThrow(
      /Setting 'server_port' is locked by CLI override/,
    )
  })

  it('settings:getLocked reflects the shared service state', async () => {
    const dispatch = new DispatchRegistry()
    const db = await createTestDb()
    const shared = new SettingsService(db as any)
    shared.lockKey('server_port')
    shared.lockKey('server_accessMode')
    registerSettingsHandlers(dispatch, db as any, shared)

    const getLocked = dispatch.get('settings:getLocked')!
    const result = await getLocked() as string[]
    expect(result).toEqual(['server_accessMode', 'server_port'])
  })
})
