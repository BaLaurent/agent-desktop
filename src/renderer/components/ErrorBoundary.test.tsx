import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

let shouldThrow = true

function ThrowingComponent() {
  if (shouldThrow) throw new Error('Test error')
  return <div>Recovered</div>
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Safe content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('Safe content')).toBeInTheDocument()
  })

  it('shows error message when child throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    shouldThrow = true
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test error')).toBeInTheDocument()

    consoleSpy.mockRestore()
  })

  it('Try again button resets error state and re-renders children', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    shouldThrow = true
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Switch to non-throwing mode and click Try again
    shouldThrow = false
    fireEvent.click(screen.getByText('Try again'))

    expect(screen.getByText('Recovered')).toBeInTheDocument()

    consoleSpy.mockRestore()
  })
})
