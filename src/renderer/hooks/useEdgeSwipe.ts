import { useEffect, useRef } from 'react'

interface SwipeOptions {
  /** Minimum horizontal distance to trigger (default 60) */
  threshold?: number
  /** Maximum vertical drift allowed (default 80) */
  maxVerticalDrift?: number
}

interface EdgeSwipeOptions extends SwipeOptions {
  /** Edge zone width in px (default 24) */
  edgeWidth?: number
}

/**
 * Detects swipe-from-edge gestures on touch devices.
 * `onSwipeFromLeft` fires when the user swipes right starting from the left edge.
 * `onSwipeFromRight` fires when the user swipes left starting from the right edge.
 */
export function useEdgeSwipe(
  onSwipeFromLeft: (() => void) | null,
  onSwipeFromRight: (() => void) | null,
  options: EdgeSwipeOptions = {},
): void {
  const optsRef = useRef(options)
  optsRef.current = options

  const leftRef = useRef(onSwipeFromLeft)
  leftRef.current = onSwipeFromLeft

  const rightRef = useRef(onSwipeFromRight)
  rightRef.current = onSwipeFromRight

  useEffect(() => {
    let startX = 0
    let startY = 0
    let fromEdge: 'left' | 'right' | null = null

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      const { edgeWidth = 24 } = optsRef.current
      startX = touch.clientX
      startY = touch.clientY

      if (startX <= edgeWidth && leftRef.current) {
        fromEdge = 'left'
      } else if (startX >= window.innerWidth - edgeWidth && rightRef.current) {
        fromEdge = 'right'
      } else {
        fromEdge = null
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!fromEdge) return
      const touch = e.changedTouches[0]
      if (!touch) return

      const { threshold = 60, maxVerticalDrift = 80 } = optsRef.current
      const dx = touch.clientX - startX
      const dy = Math.abs(touch.clientY - startY)

      if (dy > maxVerticalDrift) {
        fromEdge = null
        return
      }

      if (fromEdge === 'left' && dx >= threshold) {
        leftRef.current?.()
      } else if (fromEdge === 'right' && -dx >= threshold) {
        rightRef.current?.()
      }

      fromEdge = null
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [])
}

/**
 * Detects a swipe in a given direction anywhere on the screen.
 * Pass `null` as `onSwipe` to disable. Useful for dismissing overlays.
 */
export function useSwipeDismiss(
  direction: 'left' | 'right' | null,
  onSwipe: (() => void) | null,
  options: SwipeOptions = {},
): void {
  const optsRef = useRef(options)
  optsRef.current = options

  const cbRef = useRef(onSwipe)
  cbRef.current = onSwipe

  const dirRef = useRef(direction)
  dirRef.current = direction

  useEffect(() => {
    let startX = 0
    let startY = 0

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      startX = touch.clientX
      startY = touch.clientY
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!dirRef.current || !cbRef.current) return
      const touch = e.changedTouches[0]
      if (!touch) return

      const { threshold = 80, maxVerticalDrift = 80 } = optsRef.current
      const dx = touch.clientX - startX
      const dy = Math.abs(touch.clientY - startY)

      if (dy > maxVerticalDrift) return

      if (dirRef.current === 'left' && dx <= -threshold) {
        cbRef.current()
      } else if (dirRef.current === 'right' && dx >= threshold) {
        cbRef.current()
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [])
}
