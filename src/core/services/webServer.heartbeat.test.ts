import { describe, it, expect } from 'vitest'
import { heartbeatDecision } from './webServer'

// The heartbeat hardening tolerates transient mobile-background pong delays:
// a client is terminated only after N *consecutive* missed pongs, not one.
// These tests pin the tolerance boundary so it can't silently regress (e.g.
// a `>=` flipped to `>`, or the threshold lowered back to a single tick).
describe('heartbeatDecision', () => {
  it('pings (incrementing the miss count) while under the threshold', () => {
    expect(heartbeatDecision(0, 3)).toEqual({ action: 'ping', missed: 1 })
    expect(heartbeatDecision(1, 3)).toEqual({ action: 'ping', missed: 2 })
  })

  it('terminates once the incremented count reaches the threshold', () => {
    // missed=2 → next=3 → reaches max(3) → terminate (≈ 3 × 30s tolerance).
    expect(heartbeatDecision(2, 3)).toEqual({ action: 'terminate' })
    expect(heartbeatDecision(5, 3)).toEqual({ action: 'terminate' })
  })

  it('uses a grace window wider than a single tick (the actual bug)', () => {
    // A client that misses exactly one pong must survive — this is the case a
    // backgrounded mobile tab hits mid-stream.
    expect(heartbeatDecision(0).action).toBe('ping')
  })
})
