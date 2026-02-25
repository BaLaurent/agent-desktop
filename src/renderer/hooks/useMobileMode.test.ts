import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMobileMode, useCompactMode, MOBILE_BREAKPOINT, COMPACT_BREAKPOINT } from './useMobileMode'

describe('useMobileMode', () => {
  const originalInnerWidth = window.innerWidth

  afterEach(() => {
    delete (window as any).__AGENT_WEB_MODE__
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true })
    document.documentElement.classList.remove('mobile')
    document.documentElement.classList.remove('compact')
  })

  it('returns false on wide window without web mode', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true })
    const { result } = renderHook(() => useMobileMode())
    expect(result.current).toBe(false)
  })

  it('returns true when __AGENT_WEB_MODE__ is set regardless of width', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true })
    ;(window as any).__AGENT_WEB_MODE__ = true
    const { result } = renderHook(() => useMobileMode())
    expect(result.current).toBe(true)
  })

  it('returns true when window is narrow', () => {
    Object.defineProperty(window, 'innerWidth', { value: MOBILE_BREAKPOINT - 1, writable: true })
    const { result } = renderHook(() => useMobileMode())
    expect(result.current).toBe(true)
  })

  it('returns false at exactly the breakpoint', () => {
    Object.defineProperty(window, 'innerWidth', { value: MOBILE_BREAKPOINT, writable: true })
    const { result } = renderHook(() => useMobileMode())
    expect(result.current).toBe(false)
  })

  it('reacts to resize events', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true })
    const { result } = renderHook(() => useMobileMode())
    expect(result.current).toBe(false)

    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(true)

    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(false)
  })

  it('syncs .mobile class on <html>', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true })
    window.dispatchEvent(new Event('resize'))
    expect(document.documentElement.classList.contains('mobile')).toBe(true)

    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true })
    window.dispatchEvent(new Event('resize'))
    expect(document.documentElement.classList.contains('mobile')).toBe(false)
  })
})

describe('useCompactMode', () => {
  const originalInnerWidth = window.innerWidth

  afterEach(() => {
    delete (window as any).__AGENT_WEB_MODE__
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true })
    document.documentElement.classList.remove('mobile')
    document.documentElement.classList.remove('compact')
  })

  it('returns false on wide window', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
    const { result } = renderHook(() => useCompactMode())
    expect(result.current).toBe(false)
  })

  it('returns true between mobile and compact breakpoints', () => {
    Object.defineProperty(window, 'innerWidth', { value: 900, writable: true })
    const { result } = renderHook(() => useCompactMode())
    expect(result.current).toBe(true)
  })

  it('returns true when mobile (compact is superset)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true })
    const { result } = renderHook(() => useCompactMode())
    expect(result.current).toBe(true)
  })

  it('returns true when __AGENT_WEB_MODE__ is set', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true })
    ;(window as any).__AGENT_WEB_MODE__ = true
    const { result } = renderHook(() => useCompactMode())
    expect(result.current).toBe(true)
  })

  it('returns false at exactly the compact breakpoint', () => {
    Object.defineProperty(window, 'innerWidth', { value: COMPACT_BREAKPOINT, writable: true })
    const { result } = renderHook(() => useCompactMode())
    expect(result.current).toBe(false)
  })

  it('reacts to resize events', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
    const { result } = renderHook(() => useCompactMode())
    expect(result.current).toBe(false)

    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 900, writable: true })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(true)

    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(false)
  })

  it('syncs .compact class on <html>', () => {
    Object.defineProperty(window, 'innerWidth', { value: 900, writable: true })
    window.dispatchEvent(new Event('resize'))
    expect(document.documentElement.classList.contains('compact')).toBe(true)

    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true })
    window.dispatchEvent(new Event('resize'))
    expect(document.documentElement.classList.contains('compact')).toBe(false)
  })

  it('compact includes mobile range (.compact + .mobile both set)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true })
    window.dispatchEvent(new Event('resize'))
    expect(document.documentElement.classList.contains('compact')).toBe(true)
    expect(document.documentElement.classList.contains('mobile')).toBe(true)
  })
})
