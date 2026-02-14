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

  it('renders nothing when content is empty string', () => {
    const { container } = render(<OverlayResponse content="" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders markdown content when provided', () => {
    render(<OverlayResponse content="Hello **world**" />)
    expect(screen.getByTestId('markdown')).toHaveTextContent('Hello **world**')
  })

  it('renders the scrollable container with max height', () => {
    const { container } = render(<OverlayResponse content="some content" />)
    const scrollDiv = container.firstChild as HTMLElement
    expect(scrollDiv.style.maxHeight).toBe('260px')
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

  it('applies overflow-y-auto class for scrolling', () => {
    const { container } = render(<OverlayResponse content="text" />)
    const scrollDiv = container.firstChild as HTMLElement
    expect(scrollDiv.className).toContain('overflow-y-auto')
  })
})
