import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerSettingsHandlers } from './settings'
import { SettingsService } from '../services/settings'
import { createTestDb } from '../__tests__/db-helper'

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

  it('settings:set records ai_model as the last native selection for the active backend', async () => {
    const set = dispatch.get('settings:set')!
    const get = dispatch.get('settings:get')!
    // Default backend is claude-agent-sdk; a bare claude- id is native.
    await set('ai_model', 'claude-opus-4-7')
    const all = await get() as Record<string, string>
    expect(JSON.parse(all['ai_lastModelByBackend'])).toEqual({ 'claude-agent-sdk': 'claude-opus-4-7' })
  })

  it('settings:set does NOT record a cross-backend or custom id', async () => {
    const set = dispatch.get('settings:set')!
    const get = dispatch.get('settings:get')!
    // Backend is claude-agent-sdk but the value is a PI-style id → not native.
    await set('ai_model', 'anthropic/claude-3-5-haiku')
    await set('ai_model', 'custom')
    const all = await get() as Record<string, string>
    expect(all['ai_lastModelByBackend']).toBeUndefined()
  })

  it('settings:set tracks selections per backend independently', async () => {
    const set = dispatch.get('settings:set')!
    const get = dispatch.get('settings:get')!
    await set('ai_model', 'claude-sonnet-4-6')
    await set('ai_sdkBackend', 'pi')
    await set('ai_model', 'anthropic/claude-3-5-haiku')
    const all = await get() as Record<string, string>
    expect(JSON.parse(all['ai_lastModelByBackend'])).toEqual({
      'claude-agent-sdk': 'claude-sonnet-4-6',
      'pi': 'anthropic/claude-3-5-haiku',
    })
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
