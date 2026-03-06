// src/renderer/components/chat/DiffView.test.tsx
import { render, screen } from '@testing-library/react'
import { DiffView } from './DiffView'

describe('DiffView', () => {
  it('renders Before and After column headers', () => {
    render(<DiffView oldStr="hello" newStr="world" />)
    expect(screen.getByText(/Before/)).toBeInTheDocument()
    expect(screen.getByText(/After/)).toBeInTheDocument()
  })

  it('renders old text in left column', () => {
    render(<DiffView oldStr="console.log(x)" newStr="console.info(x)" />)
    expect(screen.getByTestId('diff-left')).toHaveTextContent('console.log(x)')
  })

  it('renders new text in right column', () => {
    render(<DiffView oldStr="console.log(x)" newStr="console.info(x)" />)
    expect(screen.getByTestId('diff-right')).toHaveTextContent('console.info(x)')
  })

  it('highlights removed text with diff-removed class', () => {
    const { container } = render(<DiffView oldStr="aaa" newStr="bbb" />)
    const removed = container.querySelectorAll('.diff-removed')
    expect(removed.length).toBeGreaterThan(0)
  })

  it('highlights added text with diff-added class', () => {
    const { container } = render(<DiffView oldStr="aaa" newStr="bbb" />)
    const added = container.querySelectorAll('.diff-added')
    expect(added.length).toBeGreaterThan(0)
  })

  it('handles identical strings (no diff highlights)', () => {
    const { container } = render(<DiffView oldStr="same" newStr="same" />)
    expect(container.querySelectorAll('.diff-removed').length).toBe(0)
    expect(container.querySelectorAll('.diff-added').length).toBe(0)
  })

  it('handles empty old string (full addition)', () => {
    render(<DiffView oldStr="" newStr="new content" />)
    expect(screen.getByTestId('diff-right')).toHaveTextContent('new content')
  })

  it('handles multiline strings with line numbers', () => {
    render(<DiffView oldStr={"line1\nline2"} newStr={"line1\nchanged"} />)
    expect(screen.getByTestId('diff-left')).toHaveTextContent('1')
    expect(screen.getByTestId('diff-left')).toHaveTextContent('2')
  })
})
