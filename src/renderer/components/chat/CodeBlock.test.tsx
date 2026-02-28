import { render, screen, fireEvent, act } from '@testing-library/react'
import { CodeBlock } from './CodeBlock'

vi.mock('../../lib/hljs', () => ({
  default: {
    highlightElement: vi.fn(),
    highlightAuto: vi.fn().mockReturnValue({ language: undefined, value: '', relevance: 0 }),
  },
}))

import hljs from '../../lib/hljs'

beforeAll(() => {
  vi.useFakeTimers()
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterAll(() => {
  vi.useRealTimers()
})

const shortCode = 'const x = 1'
const longCode = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n')

describe('CodeBlock', () => {
  it('renders code content when short (expanded by default)', () => {
    render(<CodeBlock language="typescript">{shortCode}</CodeBlock>)
    expect(screen.getByText(shortCode)).toBeInTheDocument()
  })

  it('shows language label', () => {
    render(<CodeBlock language="typescript">{shortCode}</CodeBlock>)
    expect(screen.getByText('typescript')).toBeInTheDocument()
  })

  it('falls back to text when no language prop', () => {
    render(<CodeBlock>{shortCode}</CodeBlock>)
    expect(screen.getByText('text')).toBeInTheDocument()
  })

  it('has Copy button', () => {
    render(<CodeBlock language="js">{shortCode}</CodeBlock>)
    expect(screen.getByText('Copy')).toBeInTheDocument()
  })

  // --- Fold/unfold tests ---

  it('collapses by default when code exceeds 10 lines', () => {
    render(<CodeBlock language="js">{longCode}</CodeBlock>)
    // Code content should NOT be in the DOM
    expect(screen.queryByText(/line 1/)).not.toBeInTheDocument()
    // Line count badge should be visible
    expect(screen.getByText('15 lines')).toBeInTheDocument()
  })

  it('expands by default when code is 10 lines or fewer', () => {
    render(<CodeBlock language="js">{shortCode}</CodeBlock>)
    expect(screen.getByText(shortCode)).toBeInTheDocument()
    expect(screen.queryByText(/lines$/)).not.toBeInTheDocument()
  })

  it('toggles collapsed state on header click', () => {
    render(<CodeBlock language="js">{longCode}</CodeBlock>)
    // Initially collapsed
    expect(screen.queryByText(/line 1/)).not.toBeInTheDocument()

    // Click the toggle button (contains the language label)
    fireEvent.click(screen.getByText('js'))

    // Now expanded — code block renders all lines as one text node
    expect(screen.getByText(/line 1/)).toBeInTheDocument()
    expect(screen.queryByText('15 lines')).not.toBeInTheDocument()

    // Click again to collapse
    fireEvent.click(screen.getByText('js'))
    expect(screen.queryByText(/line 1/)).not.toBeInTheDocument()
    expect(screen.getByText('15 lines')).toBeInTheDocument()
  })

  it('respects defaultCollapsed=true even for short code', () => {
    render(<CodeBlock language="js" defaultCollapsed>{shortCode}</CodeBlock>)
    expect(screen.queryByText(shortCode)).not.toBeInTheDocument()
    expect(screen.getByText('1 lines')).toBeInTheDocument()
  })

  it('respects defaultCollapsed=false even for long code', () => {
    render(<CodeBlock language="js" defaultCollapsed={false}>{longCode}</CodeBlock>)
    expect(screen.getByText(/line 1/)).toBeInTheDocument()
  })

  it('keeps Copy button visible when collapsed', () => {
    render(<CodeBlock language="js">{longCode}</CodeBlock>)
    expect(screen.getByText('Copy')).toBeInTheDocument()
  })

  // --- Syntax highlighting tests ---

  it('calls hljs.highlightElement after debounce when language is provided and expanded', () => {
    vi.mocked(hljs.highlightElement).mockClear()
    render(<CodeBlock language="typescript">{shortCode}</CodeBlock>)
    // Not called immediately (debounced)
    expect(hljs.highlightElement).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(150) })
    expect(hljs.highlightElement).toHaveBeenCalled()
  })

  it('does not call hljs.highlightElement when no language (uses highlightAuto instead)', () => {
    vi.mocked(hljs.highlightElement).mockClear()
    vi.mocked(hljs.highlightAuto).mockClear()
    render(<CodeBlock>{shortCode}</CodeBlock>)
    act(() => { vi.advanceTimersByTime(150) })
    expect(hljs.highlightElement).not.toHaveBeenCalled()
    expect(hljs.highlightAuto).toHaveBeenCalledWith(shortCode)
  })

  it('does not call hljs.highlightElement when collapsed', () => {
    vi.mocked(hljs.highlightElement).mockClear()
    render(<CodeBlock language="js">{longCode}</CodeBlock>)
    act(() => { vi.advanceTimersByTime(150) })
    // longCode > 10 lines → collapsed by default
    expect(hljs.highlightElement).not.toHaveBeenCalled()
  })

  it('debounces hljs during rapid content changes (streaming)', () => {
    vi.mocked(hljs.highlightElement).mockClear()
    const { rerender } = render(<CodeBlock language="js">{'chunk 1'}</CodeBlock>)
    act(() => { vi.advanceTimersByTime(50) })
    rerender(<CodeBlock language="js">{'chunk 1\nchunk 2'}</CodeBlock>)
    act(() => { vi.advanceTimersByTime(50) })
    rerender(<CodeBlock language="js">{'chunk 1\nchunk 2\nchunk 3'}</CodeBlock>)
    // Still within debounce window — not called yet
    expect(hljs.highlightElement).not.toHaveBeenCalled()
    // After final chunk settles
    act(() => { vi.advanceTimersByTime(150) })
    expect(hljs.highlightElement).toHaveBeenCalledTimes(1)
  })

  // --- Auto-detection tests ---

  it('shows detected language label when highlightAuto returns high relevance', () => {
    vi.mocked(hljs.highlightAuto).mockReturnValue({
      language: 'python',
      value: '<span class="hljs-built_in">print</span>(<span class="hljs-string">"hello"</span>)',
      relevance: 10,
    } as any)
    render(<CodeBlock>{'print("hello")'}</CodeBlock>)
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getByText('python')).toBeInTheDocument()
  })

  it('shows "text" when highlightAuto relevance is below threshold', () => {
    vi.mocked(hljs.highlightAuto).mockReturnValue({
      language: 'yaml',
      value: 'hello world',
      relevance: 2,
    } as any)
    render(<CodeBlock>{'hello world'}</CodeBlock>)
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getByText('text')).toBeInTheDocument()
  })

  it('shows "text" when highlightAuto returns no language', () => {
    vi.mocked(hljs.highlightAuto).mockReturnValue({
      language: undefined,
      value: '┌──────┐',
      relevance: 0,
    } as any)
    render(<CodeBlock>{'┌──────┐'}</CodeBlock>)
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getByText('text')).toBeInTheDocument()
  })

  it('applies highlighted HTML from highlightAuto when detected', () => {
    const highlightedHtml = '<span class="hljs-keyword">const</span> x = 1'
    vi.mocked(hljs.highlightAuto).mockReturnValue({
      language: 'javascript',
      value: highlightedHtml,
      relevance: 8,
    } as any)
    const { container } = render(<CodeBlock>{'const x = 1'}</CodeBlock>)
    act(() => { vi.advanceTimersByTime(150) })
    const code = container.querySelector('code')
    expect(code?.innerHTML).toBe(highlightedHtml)
  })

  it('prefers explicit language over auto-detection', () => {
    vi.mocked(hljs.highlightElement).mockClear()
    vi.mocked(hljs.highlightAuto).mockClear()
    render(<CodeBlock language="typescript">{shortCode}</CodeBlock>)
    act(() => { vi.advanceTimersByTime(150) })
    expect(hljs.highlightElement).toHaveBeenCalled()
    expect(hljs.highlightAuto).not.toHaveBeenCalled()
  })
})
