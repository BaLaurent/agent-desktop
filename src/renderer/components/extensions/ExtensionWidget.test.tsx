import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExtensionWidget } from './ExtensionWidget'
import type { PiUIWidget } from '../../../shared/piUITypes'

describe('ExtensionWidget', () => {
  const widget: PiUIWidget = {
    key: 'test-widget',
    content: ['line one', 'line two', 'line three'],
    placement: 'belowEditor',
  }

  it('renders each content line', () => {
    render(<ExtensionWidget widget={widget} />)
    expect(screen.getByText('line one')).toBeInTheDocument()
    expect(screen.getByText('line two')).toBeInTheDocument()
    expect(screen.getByText('line three')).toBeInTheDocument()
  })

  it('has accent border on the left', () => {
    render(<ExtensionWidget widget={widget} />)
    const container = screen.getByTestId('extension-widget-test-widget')
    expect(container.style.borderLeft).toContain('var(--color-primary)')
  })

  it('uses monospace font', () => {
    render(<ExtensionWidget widget={widget} />)
    const container = screen.getByTestId('extension-widget-test-widget')
    expect(container.style.fontFamily).toBe('monospace')
  })
})
