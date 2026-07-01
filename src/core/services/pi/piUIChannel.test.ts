/**
 * Coverage for the PI extension-UI channel: the injectable main→renderer sender
 * and the request/response registry that routes renderer answers back to the
 * per-turn omp client. Pure logic — no subprocess, no Electron.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setPIUISender,
  emitPIUIEvent,
  emitPIUIRequest,
  respondPIUI,
  cancelPendingPIUI,
} from './piUIChannel'
import type { PiUIDialog, PiUIResponse } from '../../types/piUITypes'

const selectDialog: PiUIDialog = { id: 'd1', method: 'select', title: 'Pick', options: ['A', 'B'] }

beforeEach(() => {
  // Reset the injected sender between tests; cancel any leftover pending state.
  cancelPendingPIUI()
  setPIUISender(null)
})

describe('piUIChannel', () => {
  it('emitPIUIEvent pushes on the pi:uiEvent channel', () => {
    const sender = vi.fn()
    setPIUISender(sender)
    emitPIUIEvent({ method: 'notify', message: 'hi', level: 'info' })
    expect(sender).toHaveBeenCalledWith('pi:uiEvent', { method: 'notify', message: 'hi', level: 'info' })
  })

  it('emitPIUIRequest pushes on pi:uiRequest and resolves the responder on respondPIUI', () => {
    const sender = vi.fn()
    setPIUISender(sender)
    const responder = vi.fn<(r: PiUIResponse) => void>()
    emitPIUIRequest(selectDialog, responder)
    expect(sender).toHaveBeenCalledWith('pi:uiRequest', selectDialog)

    respondPIUI({ id: 'd1', value: 'A' })
    expect(responder).toHaveBeenCalledWith({ id: 'd1', value: 'A' })
  })

  it('respondPIUI resolves each responder exactly once (stale reply is a no-op)', () => {
    setPIUISender(vi.fn())
    const responder = vi.fn<(r: PiUIResponse) => void>()
    emitPIUIRequest(selectDialog, responder)
    respondPIUI({ id: 'd1', value: 'A' })
    respondPIUI({ id: 'd1', value: 'B' }) // stale
    expect(responder).toHaveBeenCalledTimes(1)
  })

  it('respondPIUI for an unknown id is a no-op (no throw)', () => {
    expect(() => respondPIUI({ id: 'nope', value: 'x' })).not.toThrow()
  })

  it('cancelPendingPIUI resolves every pending responder as cancelled', () => {
    setPIUISender(vi.fn())
    const r1 = vi.fn<(r: PiUIResponse) => void>()
    const r2 = vi.fn<(r: PiUIResponse) => void>()
    emitPIUIRequest({ ...selectDialog, id: 'a' }, r1)
    emitPIUIRequest({ ...selectDialog, id: 'b' }, r2)
    cancelPendingPIUI()
    expect(r1).toHaveBeenCalledWith({ id: 'a', cancelled: true })
    expect(r2).toHaveBeenCalledWith({ id: 'b', cancelled: true })
    // Subsequent responses are no-ops (already resolved + removed).
    respondPIUI({ id: 'a', value: 'late' })
    expect(r1).toHaveBeenCalledTimes(1)
  })

  it('emit helpers are safe no-ops when no sender is injected', () => {
    setPIUISender(null)
    expect(() => emitPIUIEvent({ method: 'setStatus', key: 'k', text: 't' })).not.toThrow()
    // A request with no sender still registers its responder so a later respond works.
    const responder = vi.fn<(r: PiUIResponse) => void>()
    emitPIUIRequest(selectDialog, responder)
    respondPIUI({ id: 'd1', confirmed: true })
    expect(responder).toHaveBeenCalledWith({ id: 'd1', confirmed: true })
  })
})
