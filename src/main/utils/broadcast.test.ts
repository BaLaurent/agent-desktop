import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setBroadcastHandler, broadcast } from './broadcast'

describe('broadcast', () => {
  beforeEach(() => {
    setBroadcastHandler(null as any)
  })

  it('is no-op without handler', () => {
    // Should not throw
    broadcast('test:channel', { data: 1 })
  })

  it('calls handler when set', () => {
    const handler = vi.fn()
    setBroadcastHandler(handler)
    broadcast('test:channel', { data: 1 }, 'extra')
    expect(handler).toHaveBeenCalledWith('test:channel', { data: 1 }, 'extra')
  })

  it('replaces previous handler', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    setBroadcastHandler(handler1)
    setBroadcastHandler(handler2)
    broadcast('ch', 42)
    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).toHaveBeenCalledWith('ch', 42)
  })
})
