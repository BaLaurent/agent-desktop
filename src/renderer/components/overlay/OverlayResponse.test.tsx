vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}))

vi.mock('remark-gfm', () => ({
  default: {},
}))

import { render, screen } from '@testing-library/react'
import { OverlayResponse } from './OverlayResponse'

describe('OverlayResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty container when content is empty string', () => {
    const { container } = render(<OverlayResponse content="" />)
    const scrollDiv = container.firstChild as HTMLElement
    expect(scrollDiv).toBeTruthy()
    expect(scrollDiv.querySelector('[data-testid="markdown"]')).toBeNull()
  })

  it('renders markdown content when provided', () => {
    render(<OverlayResponse content="Hello **world**" />)
    expect(screen.getByTestId('markdown')).toHaveTextContent('Hello **world**')
  })

  it('renders as a flex-1 scrollable container', () => {
    const { container } = render(<OverlayResponse content="some content" />)
    const scrollDiv = container.firstChild as HTMLElement
    expect(scrollDiv.className).toContain('flex-1')
    expect(scrollDiv.className).toContain('min-h-0')
    expect(scrollDiv.className).toContain('overflow-y-auto')
  })

  it('auto-scrolls container to bottom when content changes', () => {
    const scrollTopSetter = vi.fn()
    const mockScrollHeight = 500

    // Spy on the ref's scrollTop assignment via Object.defineProperty on HTMLDivElement prototype
    const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      set: scrollTopSetter,
      get: () => 0,
      configurable: true,
    })

    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      get: () => mockScrollHeight,
      configurable: true,
    })

    render(<OverlayResponse content="initial" />)

    // The useEffect sets scrollTop = scrollHeight
    expect(scrollTopSetter).toHaveBeenCalledWith(mockScrollHeight)

    // Restore
    if (originalDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalDescriptor)
    }
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
    }
  })
})
