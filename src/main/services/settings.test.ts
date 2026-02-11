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
    await ipc.invoke('settings:set', 'custom_key', 'custom_value')
    const settings = await ipc.invoke('settings:get') as Record<string, string>
    expect(settings.custom_key).toBe('custom_value')
  })

  it('set existing key updates value', async () => {
    await ipc.invoke('settings:set', 'theme', 'light')
    const settings = await ipc.invoke('settings:get') as Record<string, string>
    expect(settings.theme).toBe('light')
  })

  it('get after set reflects new value', async () => {
    const before = await ipc.invoke('settings:get') as Record<string, string>
    expect(before.ai_maxTurns).toBe('50')

    await ipc.invoke('settings:set', 'ai_maxTurns', '5')

    const after = await ipc.invoke('settings:get') as Record<string, string>
    expect(after.ai_maxTurns).toBe('5')
  })
})
