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

  it('does not throw when ref.current is null', () => {
    const ref = createRef<HTMLDivElement>()
    // ref.current is null by default — never assigned

    const onClose = vi.fn()
    renderHook(() => useClickOutside(ref, onClose))

    // Should not throw and should not call onClose (guard: ref.current && ...)
    expect(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    }).not.toThrow()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not call onClose when clicking a nested child element', () => {
    const ref = createRef<HTMLDivElement>()
    const parent = document.createElement('div')
    const child = document.createElement('span')
    parent.appendChild(child)
    document.body.appendChild(parent)
    ;(ref as any).current = parent

    const onClose = vi.fn()
    renderHook(() => useClickOutside(ref, onClose))

    // Click on nested child — .contains() should return true
    child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()

    document.body.removeChild(parent)
  })

  it('uses the latest onClose callback after rerender', () => {
    const ref = createRef<HTMLDivElement>()
    const div = document.createElement('div')
    document.body.appendChild(div)
    ;(ref as any).current = div

    const oldClose = vi.fn()
    const newClose = vi.fn()

    const { rerender } = renderHook(
      ({ cb }) => useClickOutside(ref, cb),
      { initialProps: { cb: oldClose } },
    )

    // Rerender with a new callback
    rerender({ cb: newClose })

    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(oldClose).not.toHaveBeenCalled()
    expect(newClose).toHaveBeenCalledTimes(1)

    document.body.removeChild(div)
  })
})
