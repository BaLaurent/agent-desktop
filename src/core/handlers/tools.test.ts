import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerToolsHandlers } from './tools'
import { createTestDb } from '../__tests__/db-helper'

describe('tools handlers', () => {
  let dispatch: DispatchRegistry

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerToolsHandlers(dispatch, db as any)
  })

  it('registers tools:listAvailable handler', () => {
    expect(dispatch.has('tools:listAvailable')).toBe(true)
  })

  it('registers tools:setEnabled handler', () => {
    expect(dispatch.has('tools:setEnabled')).toBe(true)
  })

  it('registers tools:toggle handler', () => {
    expect(dispatch.has('tools:toggle')).toBe(true)
  })

  it('tools:listAvailable returns an array of tools', async () => {
    const listAvailable = dispatch.get('tools:listAvailable')!
    const result = await listAvailable() as Array<{ name: string; enabled: boolean }>
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toHaveProperty('name')
    expect(result[0]).toHaveProperty('enabled')
  })

  it('tools:toggle disables then re-enables a tool', async () => {
    const listAvailable = dispatch.get('tools:listAvailable')!
    const toggle = dispatch.get('tools:toggle')!

    const before = await listAvailable() as Array<{ name: string; enabled: boolean }>
    const bashTool = before.find(t => t.name === 'Bash')!
    expect(bashTool.enabled).toBe(true)

    await toggle('Bash')
    const after = await listAvailable() as Array<{ name: string; enabled: boolean }>
    expect(after.find(t => t.name === 'Bash')!.enabled).toBe(false)

    await toggle('Bash')
    const restored = await listAvailable() as Array<{ name: string; enabled: boolean }>
    expect(restored.find(t => t.name === 'Bash')!.enabled).toBe(true)
  })
})
