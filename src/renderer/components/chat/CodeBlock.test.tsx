import { render, screen, fireEvent } from '@testing-library/react'
import { CodeBlock } from './CodeBlock'

beforeAll(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
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
})
