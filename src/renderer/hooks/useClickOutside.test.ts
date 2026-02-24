import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { useClickOutside } from './useClickOutside'

describe('useClickOutside', () => {
  it('calls onClose when clicking outside the ref element', () => {
    const ref = createRef<HTMLDivElement>()
    const div = document.createElement('div')
    document.body.appendChild(div)
    ;(ref as any).current = div

    const onClose = vi.fn()
    renderHook(() => useClickOutside(ref, onClose))

    // Click outside the element
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)

    document.body.removeChild(div)
  })

  it('does not call onClose when clicking inside the ref element', () => {
    const ref = createRef<HTMLDivElement>()
    const div = document.createElement('div')
    document.body.appendChild(div)
    ;(ref as any).current = div

    const onClose = vi.fn()
    renderHook(() => useClickOutside(ref, onClose))

    // Click inside the element
    div.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()

    document.body.removeChild(div)
  })

  it('responds to touchstart events (mobile support)', () => {
    const ref = createRef<HTMLDivElement>()
    const div = document.createElement('div')
    document.body.appendChild(div)
    ;(ref as any).current = div

    const onClose = vi.fn()
    renderHook(() => useClickOutside(ref, onClose))

    // Touch outside the element
    document.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)

    document.body.removeChild(div)
  })

  it('removes listeners on unmount', () => {
    const ref = createRef<HTMLDivElement>()
    const div = document.createElement('div')
    document.body.appendChild(div)
    ;(ref as any).current = div

    const onClose = vi.fn()
    const { unmount } = renderHook(() => useClickOutside(ref, onClose))
    unmount()

    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()

    document.body.removeChild(div)
  })
})
