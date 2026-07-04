import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerMcpHandlers } from './mcp'
import { createTestDb } from '../__tests__/db-helper'

describe('mcp handlers', () => {
  let dispatch: DispatchRegistry

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerMcpHandlers(dispatch, db as any)
  })

  it('registers mcp:listServers handler', () => {
    expect(dispatch.has('mcp:listServers')).toBe(true)
  })

  it('registers mcp:addServer handler', () => {
    expect(dispatch.has('mcp:addServer')).toBe(true)
  })

  it('registers mcp:updateServer handler', () => {
    expect(dispatch.has('mcp:updateServer')).toBe(true)
  })

  it('registers mcp:removeServer handler', () => {
    expect(dispatch.has('mcp:removeServer')).toBe(true)
  })

  it('registers mcp:toggleServer handler', () => {
    expect(dispatch.has('mcp:toggleServer')).toBe(true)
  })

  it('registers mcp:testConnection handler', () => {
    expect(dispatch.has('mcp:testConnection')).toBe(true)
  })

  it('mcp:listServers returns an array', async () => {
    const list = dispatch.get('mcp:listServers')!
    const result = await list()
    expect(Array.isArray(result)).toBe(true)
  })

  it('mcp:addServer creates a server and mcp:listServers returns it', async () => {
    const add = dispatch.get('mcp:addServer')!
    const list = dispatch.get('mcp:listServers')!

    const server = await add({ name: 'test-server', type: 'stdio', command: 'echo', args: [], env: {} }) as { id: number; name: string }
    expect(server).toBeDefined()
    expect(server.name).toBe('test-server')

    const servers = await list() as Array<{ name: string }>
    expect(servers.some(s => s.name === 'test-server')).toBe(true)
  })

  it('mcp:removeServer removes a server', async () => {
    const add = dispatch.get('mcp:addServer')!
    const remove = dispatch.get('mcp:removeServer')!
    const list = dispatch.get('mcp:listServers')!

    const server = await add({ name: 'to-remove', type: 'stdio', command: 'echo', args: [], env: {} }) as { id: number }
    await remove(server.id)

    const servers = await list() as Array<{ name: string }>
    expect(servers.some(s => s.name === 'to-remove')).toBe(false)
  })
})
