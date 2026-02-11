import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './tools'
import type Database from 'better-sqlite3'

describe('Tools Service', () => {
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

  it('listAvailable returns 11 SDK tools, all enabled by default', async () => {
    const tools = await ipc.invoke('tools:listAvailable') as any[]
    expect(tools).toHaveLength(11)
    expect(tools.every((t: any) => t.enabled === true)).toBe(true)
  })

  it('list returns tool objects with name, description, enabled fields', async () => {
    const tools = await ipc.invoke('tools:listAvailable') as any[]
    for (const tool of tools) {
      expect(tool).toHaveProperty('name')
      expect(tool).toHaveProperty('description')
      expect(tool).toHaveProperty('enabled')
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.description).toBe('string')
      expect(typeof tool.enabled).toBe('boolean')
    }
  })

  it('toggle off one tool → that tool disabled in next listAvailable', async () => {
    await ipc.invoke('tools:toggle', 'Bash')
    const tools = await ipc.invoke('tools:listAvailable') as any[]
    const bash = tools.find((t: any) => t.name === 'Bash')
    expect(bash.enabled).toBe(false)
    // Others still enabled
    const read = tools.find((t: any) => t.name === 'Read')
    expect(read.enabled).toBe(true)
  })

  it('toggle it back on → enabled again', async () => {
    await ipc.invoke('tools:toggle', 'Bash')
    await ipc.invoke('tools:toggle', 'Bash')
    const tools = await ipc.invoke('tools:listAvailable') as any[]
    const bash = tools.find((t: any) => t.name === 'Bash')
    expect(bash.enabled).toBe(true)
  })

  it('setEnabled with JSON array of tool names → only those enabled', async () => {
    await ipc.invoke('tools:setEnabled', JSON.stringify(['Bash', 'Read']))
    const tools = await ipc.invoke('tools:listAvailable') as any[]
    const enabled = tools.filter((t: any) => t.enabled)
    expect(enabled).toHaveLength(2)
    expect(enabled.map((t: any) => t.name).sort()).toEqual(['Bash', 'Read'])
  })

  it('setEnabled with preset:claude_code → all enabled', async () => {
    // First disable some
    await ipc.invoke('tools:setEnabled', JSON.stringify(['Bash']))
    // Then re-enable all
    await ipc.invoke('tools:setEnabled', 'preset:claude_code')
    const tools = await ipc.invoke('tools:listAvailable') as any[]
    expect(tools.every((t: any) => t.enabled === true)).toBe(true)
  })
})
