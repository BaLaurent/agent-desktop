vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { ToolCallsSection } from './ToolCallsSection'

describe('ToolCallsSection', () => {
  const sampleToolCalls = JSON.stringify([
    { id: 'tool_1', name: 'Bash', input: '{"command":"npm test"}', output: 'All 483 tests passed', status: 'done' },
    { id: 'tool_2', name: 'Read', input: '{"file_path":"/src/index.ts"}', output: 'const x = 1', status: 'done' },
    { id: 'tool_3', name: 'Edit', input: '{}', output: 'File updated', status: 'done' },
  ])

  it('renders tool count in collapsed header', () => {
    render(<ToolCallsSection toolCallsJson={sampleToolCalls} />)
    expect(screen.getByText(/3 tools used/)).toBeInTheDocument()
  })

  it('is collapsed by default (does not show individual tools)', () => {
    render(<ToolCallsSection toolCallsJson={sampleToolCalls} />)
    expect(screen.queryByText('Bash')).not.toBeInTheDocument()
    expect(screen.queryByText('Read')).not.toBeInTheDocument()
  })

  it('expands to show individual tools when header is clicked', () => {
    render(<ToolCallsSection toolCallsJson={sampleToolCalls} />)

    const header = screen.getByRole('button')
    fireEvent.click(header)

    expect(screen.getByText(/Bash/)).toBeInTheDocument()
    expect(screen.getByText(/Read/)).toBeInTheDocument()
    expect(screen.getByText(/Edit/)).toBeInTheDocument()
  })

  it('collapses back when header is clicked again', () => {
    render(<ToolCallsSection toolCallsJson={sampleToolCalls} />)

    const header = screen.getByRole('button')
    fireEvent.click(header) // expand
    expect(screen.getByText(/Bash/)).toBeInTheDocument()

    fireEvent.click(header) // collapse
    expect(screen.queryByText('Bash')).not.toBeInTheDocument()
  })

  it('renders nothing for empty JSON array', () => {
    const { container } = render(<ToolCallsSection toolCallsJson="[]" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for invalid JSON', () => {
    const { container } = render(<ToolCallsSection toolCallsJson="{invalid" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders singular "tool" for single tool call', () => {
    const single = JSON.stringify([
      { id: 't1', name: 'Bash', input: '{}', output: 'ok', status: 'done' },
    ])
    render(<ToolCallsSection toolCallsJson={single} />)
    expect(screen.getByText(/1 tool used/)).toBeInTheDocument()
  })

  it('has correct aria-expanded attribute', () => {
    render(<ToolCallsSection toolCallsJson={sampleToolCalls} />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  // ── AskUserQuestion fallback rendering ──────────────────

  it('renders AskUserQuestion as fallback instead of ToolUseBlock', () => {
    const withAskUser = JSON.stringify([
      { id: 'tool_1', name: 'Bash', input: '{"command":"ls"}', output: 'file.ts', status: 'done' },
      {
        id: 'ask_1',
        name: 'AskUserQuestion',
        input: '{"questions":[{"question":"Which framework?","header":"Framework","options":[{"label":"React","description":"UI lib"}],"multiSelect":false}]}',
        output: '{"answers":{"0":"React"}}',
        status: 'done',
      },
    ])
    render(<ToolCallsSection toolCallsJson={withAskUser} />)

    // AskUserQuestion rendered inline (not inside the collapsible)
    expect(screen.getByText('Agent asked a question')).toBeInTheDocument()
    expect(screen.getByText('Which framework?')).toBeInTheDocument()
    expect(screen.getByText(/Answer: React/)).toBeInTheDocument()

    // Regular tool count excludes AskUserQuestion
    expect(screen.getByText(/1 tool used/)).toBeInTheDocument()
  })

  it('renders nothing when only AskUserQuestion calls exist (no regular tools)', () => {
    const askOnly = JSON.stringify([
      {
        id: 'ask_1',
        name: 'AskUserQuestion',
        input: '{"questions":[{"question":"Color?","header":"Color","options":[],"multiSelect":false}]}',
        output: '{}',
        status: 'done',
      },
    ])
    render(<ToolCallsSection toolCallsJson={askOnly} />)

    // Should render the fallback but no collapsible tool section
    expect(screen.getByText('Agent asked a question')).toBeInTheDocument()
    expect(screen.queryByText(/tool.*used/)).not.toBeInTheDocument()
  })

  it('AskUserFallback handles invalid JSON gracefully', () => {
    const badJson = JSON.stringify([
      { id: 'ask_bad', name: 'AskUserQuestion', input: 'not-json', output: 'also-not-json', status: 'done' },
    ])
    render(<ToolCallsSection toolCallsJson={badJson} />)

    // Should still render the header without crashing
    expect(screen.getByText('Agent asked a question')).toBeInTheDocument()
  })
})
