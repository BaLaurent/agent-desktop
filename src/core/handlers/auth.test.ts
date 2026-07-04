import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerAuthHandlers } from './auth'
import { createTestDb } from '../__tests__/db-helper'

describe('auth handlers', () => {
  let dispatch: DispatchRegistry

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerAuthHandlers(dispatch, db as any)
  })

  it('registers auth:getStatus handler', () => {
    expect(dispatch.has('auth:getStatus')).toBe(true)
  })

  it('registers auth:login handler', () => {
    expect(dispatch.has('auth:login')).toBe(true)
  })

  it('registers auth:logout handler', () => {
    expect(dispatch.has('auth:logout')).toBe(true)
  })

  it('auth:getStatus returns an AuthStatus object', async () => {
    const getStatus = dispatch.get('auth:getStatus')!
    const result = await getStatus() as { authenticated: boolean; user: unknown }
    expect(result).toBeDefined()
    expect(typeof result.authenticated).toBe('boolean')
  })

  it('auth:logout returns unauthenticated status', async () => {
    const logout = dispatch.get('auth:logout')!
    const result = await logout() as { authenticated: boolean; user: null }
    expect(result.authenticated).toBe(false)
    expect(result.user).toBeNull()
  })
})
