import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExtensionToast } from './ExtensionToast'
import type { PiUINotification } from '../../../shared/piUITypes'

describe('ExtensionToast', () => {
  const onDismiss = vi.fn<(id: string) => void>()

  beforeEach(() => {
    vi.useFakeTimers()
    onDismiss.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const makeNotification = (
    overrides: Partial<PiUINotification> = {}
  ): PiUINotification => ({
    id: 'n-1',
    message: 'Something happened',
    level: 'info',
    timestamp: Date.now(),
    ...overrides,
  })

  it('renders notification text', () => {
    const n = makeNotification({ message: 'Build succeeded' })
    render(<ExtensionToast notifications={[n]} onDismiss={onDismiss} />)
    expect(screen.getByText('Build succeeded')).toBeInTheDocument()
  })

  it('applies info color border', () => {
    const n = makeNotification({ level: 'info' })
    render(<ExtensionToast notifications={[n]} onDismiss={onDismiss} />)
    const toast = screen.getByTestId('toast-n-1')
    expect(toast.style.borderLeft).toContain('var(--color-primary)')
  })

  it('applies warning color border', () => {
    const n = makeNotification({ id: 'n-w', level: 'warning' })
    render(<ExtensionToast notifications={[n]} onDismiss={onDismiss} />)
    const toast = screen.getByTestId('toast-n-w')
    expect(toast.style.borderLeft).toContain('var(--color-warning)')
  })

  it('applies error color border', () => {
    const n = makeNotification({ id: 'n-e', level: 'error' })
    render(<ExtensionToast notifications={[n]} onDismiss={onDismiss} />)
    const toast = screen.getByTestId('toast-n-e')
    expect(toast.style.borderLeft).toContain('var(--color-error)')
  })

  it('auto-dismisses after 5 seconds', () => {
    const n = makeNotification({ id: 'n-auto' })
    render(<ExtensionToast notifications={[n]} onDismiss={onDismiss} />)
    expect(onDismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(onDismiss).toHaveBeenCalledWith('n-auto')
  })

  it('close button calls onDismiss', () => {
    const n = makeNotification({ id: 'n-close' })
    render(<ExtensionToast notifications={[n]} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByLabelText('Dismiss notification'))
    expect(onDismiss).toHaveBeenCalledWith('n-close')
  })

  it('stacks multiple notifications', () => {
    const notifications = [
      makeNotification({ id: 'n-a', message: 'First' }),
      makeNotification({ id: 'n-b', message: 'Second' }),
      makeNotification({ id: 'n-c', message: 'Third' }),
    ]
    render(<ExtensionToast notifications={notifications} onDismiss={onDismiss} />)
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getByText('Third')).toBeInTheDocument()
  })
})
