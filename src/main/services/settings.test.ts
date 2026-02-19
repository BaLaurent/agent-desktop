import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './settings'
import type Database from 'better-sqlite3'

describe('Settings Service', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(() => {
    db = createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
  })

  afterEach(() => {
    db.close()
  })

  it('get returns seeded defaults', async () => {
    const settings = await ipc.invoke('settings:get') as Record<string, string>
    expect(settings.theme).toBe('dark')
    expect(settings.ai_model).toBe('claude-sonnet-4-5-20250929')
    expect(settings.ai_permissionMode).toBe('bypassPermissions')
    expect(settings.ai_tools).toBe('preset:claude_code')
  })

  it('set new key adds to settings', async () => {
    await ipc.invoke('settings:set', 'hooks_cwdRestriction', 'false')
    const settings = await ipc.invoke('settings:get') as Record<string, string>
    expect(settings.hooks_cwdRestriction).toBe('false')
  })

  it('rejects unknown setting key', async () => {
    await expect(ipc.invoke('settings:set', 'custom_key', 'custom_value')).rejects.toThrow('Unknown setting key')
  })

  it('set existing key updates value', async () => {
    await ipc.invoke('settings:set', 'theme', 'light')
    const settings = await ipc.invoke('settings:get') as Record<string, string>
    expect(settings.theme).toBe('light')
  })

  it('accepts streamingTimeoutSeconds setting key', async () => {
    await ipc.invoke('settings:set', 'streamingTimeoutSeconds', '60')
    const settings = await ipc.invoke('settings:get') as Record<string, string>
    expect(settings.streamingTimeoutSeconds).toBe('60')
  })

  it('accepts voice_volumeDuck setting key', async () => {
    await ipc.invoke('settings:set', 'voice_volumeDuck', '30')
    const settings = await ipc.invoke('settings:get') as Record<string, string>
    expect(settings.voice_volumeDuck).toBe('30')
  })

  it('get after set reflects new value', async () => {
    const before = await ipc.invoke('settings:get') as Record<string, string>
    expect(before.ai_maxTurns).toBe('50')

    await ipc.invoke('settings:set', 'ai_maxTurns', '5')

    const after = await ipc.invoke('settings:get') as Record<string, string>
    expect(after.ai_maxTurns).toBe('5')
  })
})
