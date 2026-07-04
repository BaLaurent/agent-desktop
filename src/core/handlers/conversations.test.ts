import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerConversationsHandlers } from './conversations'
import { createTestDb } from '../__tests__/db-helper'

describe('conversations handlers', () => {
  let dispatch: DispatchRegistry

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerConversationsHandlers(dispatch, db as any)
  })

  it('registers conversations:list handler', () => {
    expect(dispatch.has('conversations:list')).toBe(true)
  })

  it('registers conversations:get handler', () => {
    expect(dispatch.has('conversations:get')).toBe(true)
  })

  it('registers conversations:markOpened handler', () => {
    expect(dispatch.has('conversations:markOpened')).toBe(true)
  })

  it('registers conversations:create handler', () => {
    expect(dispatch.has('conversations:create')).toBe(true)
  })

  it('registers conversations:update handler', () => {
    expect(dispatch.has('conversations:update')).toBe(true)
  })

  it('registers conversations:delete handler', () => {
    expect(dispatch.has('conversations:delete')).toBe(true)
  })

  it('registers conversations:deleteMany handler', () => {
    expect(dispatch.has('conversations:deleteMany')).toBe(true)
  })

  it('registers conversations:moveMany handler', () => {
    expect(dispatch.has('conversations:moveMany')).toBe(true)
  })

  it('registers conversations:colorMany handler', () => {
    expect(dispatch.has('conversations:colorMany')).toBe(true)
  })

  it('registers conversations:export handler', () => {
    expect(dispatch.has('conversations:export')).toBe(true)
  })

  it('registers conversations:import handler', () => {
    expect(dispatch.has('conversations:import')).toBe(true)
  })

  it('registers conversations:search handler', () => {
    expect(dispatch.has('conversations:search')).toBe(true)
  })

  it('registers conversations:fork handler', () => {
    expect(dispatch.has('conversations:fork')).toBe(true)
  })

  it('conversations:list returns an array', async () => {
    const list = dispatch.get('conversations:list')!
    const result = await list()
    expect(Array.isArray(result)).toBe(true)
  })

  it('conversations:create and conversations:get round-trip', async () => {
    const create = dispatch.get('conversations:create')!
    const get = dispatch.get('conversations:get')!

    const conv = await create('Hello World') as { id: number; title: string }
    expect(conv).toBeDefined()
    expect(conv.title).toBe('Hello World')

    const fetched = await get(conv.id) as { id: number; title: string }
    expect(fetched).toBeDefined()
    expect(fetched.title).toBe('Hello World')
  })

  it('conversations:search returns matching conversations', async () => {
    const create = dispatch.get('conversations:create')!
    const search = dispatch.get('conversations:search')!

    await create('UniqueSearchTitle123')
    const results = await search('UniqueSearchTitle123') as Array<{ title: string }>
    expect(results.some(r => r.title === 'UniqueSearchTitle123')).toBe(true)
  })

  it('conversations:export returns a string', async () => {
    const create = dispatch.get('conversations:create')!
    const exportFn = dispatch.get('conversations:export')!

    const conv = await create('Export Test') as { id: number }
    const result = await exportFn(conv.id, 'json')
    expect(typeof result).toBe('string')
  })
})
