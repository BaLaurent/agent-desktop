import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEdgeSwipe, useSwipeDismiss } from './useEdgeSwipe'

// Helper: create a TouchEvent with a single touch point.
// jsdom's TouchEvent constructor does not populate touches/changedTouches from
// the init dict, so we override them on the constructed event.
function makeTouchEvent(
  type: 'touchstart' | 'touchend',
  clientX: number,
  clientY: number,
): TouchEvent {
  const touch = { clientX, clientY, identifier: 0 } as unknown as Touch
  const evt = new TouchEvent(type, { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'touches', { value: [touch] })
  Object.defineProperty(evt, 'changedTouches', { value: [touch] })
  return evt
}

beforeEach(() => {
  // Set a known viewport width for right-edge calculations
  Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true })
})

// ---------- useEdgeSwipe ----------

describe('useEdgeSwipe', () => {
  it('fires onSwipeFromLeft when touch starts in left edge zone and swipes far enough', () => {
    const left = vi.fn()
    const right = vi.fn()
    renderHook(() => useEdgeSwipe(left, right))

    // Start in left edge (x=10, within default edgeWidth=24)
    document.dispatchEvent(makeTouchEvent('touchstart', 10, 100))
    // End far enough right (dx = 80, above default threshold=60)
    document.dispatchEvent(makeTouchEvent('touchend', 90, 100))

    expect(left).toHaveBeenCalledTimes(1)
    expect(right).not.toHaveBeenCalled()
  })

  it('fires onSwipeFromRight when touch starts in right edge zone and swipes left far enough', () => {
    const left = vi.fn()
    const right = vi.fn()
    renderHook(() => useEdgeSwipe(left, right))

    // Start in right edge (x=1010, within 24px of 1024)
    document.dispatchEvent(makeTouchEvent('touchstart', 1010, 200))
    // End far enough left (dx = -80)
    document.dispatchEvent(makeTouchEvent('touchend', 930, 200))

    expect(right).toHaveBeenCalledTimes(1)
    expect(left).not.toHaveBeenCalled()
  })

  it('does NOT fire when touch starts outside edge zone', () => {
    const left = vi.fn()
    const right = vi.fn()
    renderHook(() => useEdgeSwipe(left, right))

    // Start in the middle of the screen
    document.dispatchEvent(makeTouchEvent('touchstart', 500, 100))
    document.dispatchEvent(makeTouchEvent('touchend', 600, 100))

    expect(left).not.toHaveBeenCalled()
    expect(right).not.toHaveBeenCalled()
  })

  it('does NOT fire when vertical drift exceeds maxVerticalDrift', () => {
    const left = vi.fn()
    renderHook(() => useEdgeSwipe(left, null))

    // Start in left edge
    document.dispatchEvent(makeTouchEvent('touchstart', 10, 100))
    // End with enough horizontal distance but too much vertical drift (dy=100 > default 80)
    document.dispatchEvent(makeTouchEvent('touchend', 90, 200))

    expect(left).not.toHaveBeenCalled()
  })

  it('does NOT fire when horizontal distance is below threshold', () => {
    const left = vi.fn()
    renderHook(() => useEdgeSwipe(left, null))

    // Start in left edge
    document.dispatchEvent(makeTouchEvent('touchstart', 10, 100))
    // End with dx=40, below default threshold=60
    document.dispatchEvent(makeTouchEvent('touchend', 50, 100))

    expect(left).not.toHaveBeenCalled()
  })

  it('null callbacks disable detection for that edge', () => {
    const right = vi.fn()
    renderHook(() => useEdgeSwipe(null, right))

    // Swipe from left edge — should be ignored because onSwipeFromLeft is null
    document.dispatchEvent(makeTouchEvent('touchstart', 10, 100))
    document.dispatchEvent(makeTouchEvent('touchend', 90, 100))

    expect(right).not.toHaveBeenCalled()
  })

  it('respects custom options', () => {
    const left = vi.fn()
    renderHook(() =>
      useEdgeSwipe(left, null, { edgeWidth: 50, threshold: 30, maxVerticalDrift: 10 }),
    )

    // Start within custom edge (x=40 <= 50)
    document.dispatchEvent(makeTouchEvent('touchstart', 40, 100))
    // dx=35 >= custom threshold=30, dy=5 <= custom maxVerticalDrift=10
    document.dispatchEvent(makeTouchEvent('touchend', 75, 105))

    expect(left).toHaveBeenCalledTimes(1)
  })

  it('removes listeners on unmount', () => {
    const left = vi.fn()
    const { unmount } = renderHook(() => useEdgeSwipe(left, null))
    unmount()

    document.dispatchEvent(makeTouchEvent('touchstart', 10, 100))
    document.dispatchEvent(makeTouchEvent('touchend', 90, 100))

    expect(left).not.toHaveBeenCalled()
  })
})

// ---------- useSwipeDismiss ----------

describe('useSwipeDismiss', () => {
  it('fires callback when swiping left past threshold', () => {
    const cb = vi.fn()
    renderHook(() => useSwipeDismiss('left', cb))

    document.dispatchEvent(makeTouchEvent('touchstart', 500, 200))
    // dx = -100, below -threshold (-80)
    document.dispatchEvent(makeTouchEvent('touchend', 400, 200))

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('fires callback when swiping right past threshold', () => {
    const cb = vi.fn()
    renderHook(() => useSwipeDismiss('right', cb))

    document.dispatchEvent(makeTouchEvent('touchstart', 200, 200))
    // dx = 100, above threshold (80)
    document.dispatchEvent(makeTouchEvent('touchend', 300, 200))

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire when direction is null', () => {
    const cb = vi.fn()
    renderHook(() => useSwipeDismiss(null, cb))

    document.dispatchEvent(makeTouchEvent('touchstart', 500, 200))
    document.dispatchEvent(makeTouchEvent('touchend', 400, 200))

    expect(cb).not.toHaveBeenCalled()
  })

  it('does NOT fire when callback is null', () => {
    renderHook(() => useSwipeDismiss('left', null))

    // Should not throw
    document.dispatchEvent(makeTouchEvent('touchstart', 500, 200))
    document.dispatchEvent(makeTouchEvent('touchend', 400, 200))
  })

  it('does NOT fire when vertical drift is too large', () => {
    const cb = vi.fn()
    renderHook(() => useSwipeDismiss('left', cb))

    document.dispatchEvent(makeTouchEvent('touchstart', 500, 200))
    // dx = -100 (enough), but dy = 100 (> maxVerticalDrift 80)
    document.dispatchEvent(makeTouchEvent('touchend', 400, 300))

    expect(cb).not.toHaveBeenCalled()
  })

  it('does NOT fire when horizontal distance is below threshold', () => {
    const cb = vi.fn()
    renderHook(() => useSwipeDismiss('left', cb))

    document.dispatchEvent(makeTouchEvent('touchstart', 500, 200))
    // dx = -50, not past threshold of -80
    document.dispatchEvent(makeTouchEvent('touchend', 450, 200))

    expect(cb).not.toHaveBeenCalled()
  })

  it('does NOT fire for wrong direction', () => {
    const cb = vi.fn()
    renderHook(() => useSwipeDismiss('left', cb))

    // Swipe right instead of left
    document.dispatchEvent(makeTouchEvent('touchstart', 200, 200))
    document.dispatchEvent(makeTouchEvent('touchend', 400, 200))

    expect(cb).not.toHaveBeenCalled()
  })

  it('respects custom options', () => {
    const cb = vi.fn()
    renderHook(() => useSwipeDismiss('right', cb, { threshold: 20, maxVerticalDrift: 5 }))

    document.dispatchEvent(makeTouchEvent('touchstart', 100, 100))
    // dx=30 >= 20, dy=3 <= 5
    document.dispatchEvent(makeTouchEvent('touchend', 130, 103))

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('removes listeners on unmount', () => {
    const cb = vi.fn()
    const { unmount } = renderHook(() => useSwipeDismiss('left', cb))
    unmount()

    document.dispatchEvent(makeTouchEvent('touchstart', 500, 200))
    document.dispatchEvent(makeTouchEvent('touchend', 400, 200))

    expect(cb).not.toHaveBeenCalled()
  })
})
