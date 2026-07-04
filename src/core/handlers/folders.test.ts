import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerFoldersHandlers } from './folders'
import { createTestDb } from '../__tests__/db-helper'

describe('folders handlers', () => {
  let dispatch: DispatchRegistry

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerFoldersHandlers(dispatch, db as any)
  })

  it('registers folders:list handler', () => {
    expect(dispatch.has('folders:list')).toBe(true)
  })

  it('registers folders:create handler', () => {
    expect(dispatch.has('folders:create')).toBe(true)
  })

  it('registers folders:update handler', () => {
    expect(dispatch.has('folders:update')).toBe(true)
  })

  it('registers folders:delete handler', () => {
    expect(dispatch.has('folders:delete')).toBe(true)
  })

  it('registers folders:reorder handler', () => {
    expect(dispatch.has('folders:reorder')).toBe(true)
  })

  it('registers folders:getDefault handler', () => {
    expect(dispatch.has('folders:getDefault')).toBe(true)
  })

  it('folders:list returns an array', async () => {
    const list = dispatch.get('folders:list')!
    const result = await list()
    expect(Array.isArray(result)).toBe(true)
  })

  it('folders:create creates a folder and folders:list returns it', async () => {
    const create = dispatch.get('folders:create')!
    const list = dispatch.get('folders:list')!

    const folder = await create('Test Folder') as { id: number; name: string }
    expect(folder).toBeDefined()
    expect(folder.name).toBe('Test Folder')

    const folders = await list() as Array<{ name: string }>
    expect(folders.some(f => f.name === 'Test Folder')).toBe(true)
  })

  it('folders:getDefault returns the default folder', async () => {
    const getDefault = dispatch.get('folders:getDefault')!
    const folder = await getDefault() as { is_default: number }
    expect(folder).toBeDefined()
    expect(folder.is_default).toBe(1)
  })
})
