import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerShortcutsHandlers } from './shortcuts'
import { createTestDb } from '../__tests__/db-helper'

describe('shortcuts handlers', () => {
  let dispatch: DispatchRegistry

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerShortcutsHandlers(dispatch, db as any)
  })

  it('registers shortcuts:list handler', () => {
    expect(dispatch.has('shortcuts:list')).toBe(true)
  })

  it('registers shortcuts:update handler', () => {
    expect(dispatch.has('shortcuts:update')).toBe(true)
  })

  it('shortcuts:list returns an array', async () => {
    const list = dispatch.get('shortcuts:list')!
    const result = await list()
    expect(Array.isArray(result)).toBe(true)
  })

  it('shortcuts:update modifies a shortcut keybinding', async () => {
    const list = dispatch.get('shortcuts:list')!
    const update = dispatch.get('shortcuts:update')!

    const shortcuts = await list() as Array<{ id: number; keybinding: string }>
    expect(shortcuts.length).toBeGreaterThan(0)

    const first = shortcuts[0]
    await update(first.id, 'Ctrl+Shift+Z')

    const updated = await list() as Array<{ id: number; keybinding: string }>
    expect(updated.find(s => s.id === first.id)!.keybinding).toBe('Ctrl+Shift+Z')
  })
})
