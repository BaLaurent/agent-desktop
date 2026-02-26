vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

vi.mock('./McpStatusBlock', () => ({
  McpStatusBlock: ({ servers }: { servers: unknown[] }) => <div data-testid="mcp-status">{servers.length} servers</div>,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { StreamingIndicator } from './StreamingIndicator'
import type { StreamPart } from '../../../shared/types'

describe('StreamingIndicator', () => {
  it('shows "Claude is typing" when streamParts is empty', () => {
    render(<StreamingIndicator streamParts={[]} onStop={vi.fn()} />)
    expect(screen.getByText('Claude is typing')).toBeInTheDocument()
  })

  it('renders text content when text parts present', () => {
    const parts = [{ type: 'text' as const, content: 'Hello world' }]
    render(<StreamingIndicator streamParts={parts} onStop={vi.fn()} />)
    expect(screen.getByTestId('markdown')).toHaveTextContent('Hello world')
  })

  it('shows "Stop generating" button', () => {
    render(<StreamingIndicator streamParts={[]} onStop={vi.fn()} />)
    expect(screen.getByText('Stop generating')).toBeInTheDocument()
  })

  it('calls onStop when stop button clicked', () => {
    const onStop = vi.fn()
    render(<StreamingIndicator streamParts={[]} onStop={onStop} />)

    fireEvent.click(screen.getByText('Stop generating'))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('renders McpStatusBlock for mcp_status parts', () => {
    const parts: StreamPart[] = [
      { type: 'mcp_status', servers: [{ name: 'spotify', status: 'connected' }] },
    ]
    render(<StreamingIndicator streamParts={parts} onStop={vi.fn()} />)
    expect(screen.getByTestId('mcp-status')).toHaveTextContent('1 servers')
  })

  it('renders system_message content', () => {
    const parts: StreamPart[] = [
      { type: 'system_message', content: 'Lint check passed' },
    ]
    render(<StreamingIndicator streamParts={parts} onStop={vi.fn()} />)
    expect(screen.getByText('Lint check passed')).toBeInTheDocument()
  })

  it('renders hookEvent label before system_message content', () => {
    const parts: StreamPart[] = [
      { type: 'system_message', content: 'All tests green', hookEvent: 'PreToolUse' },
    ]
    render(<StreamingIndicator streamParts={parts} onStop={vi.fn()} />)
    expect(screen.getByText('PreToolUse')).toBeInTheDocument()
    expect(screen.getByText('All tests green')).toBeInTheDocument()
  })

  it('does not render hookEvent span when hookEvent is absent', () => {
    const parts: StreamPart[] = [
      { type: 'system_message', content: 'No event label' },
    ]
    const { container } = render(<StreamingIndicator streamParts={parts} onStop={vi.fn()} />)
    const sysDiv = container.querySelector('.my-2.rounded.px-3.py-2')
    expect(sysDiv).not.toBeNull()
    // No hookEvent span should exist
    expect(sysDiv!.querySelectorAll('span')).toHaveLength(0)
    // Content is rendered via MarkdownRenderer (mocked as div)
    expect(sysDiv!.querySelector('[data-testid="markdown"]')).toHaveTextContent('No event label')
  })

  it('renders system_message content through MarkdownRenderer', () => {
    const parts: StreamPart[] = [
      { type: 'system_message', content: '**bold** hook output' },
    ]
    render(<StreamingIndicator streamParts={parts} onStop={vi.fn()} />)
    // MarkdownRenderer mock renders a div with data-testid="markdown"
    const markdowns = screen.getAllByTestId('markdown')
    expect(markdowns.some((el) => el.textContent === '**bold** hook output')).toBe(true)
  })

  it('renders hookEvent label as span alongside MarkdownRenderer content', () => {
    const parts: StreamPart[] = [
      { type: 'system_message', content: 'Check result', hookEvent: 'PostToolUse' },
    ]
    const { container } = render(<StreamingIndicator streamParts={parts} onStop={vi.fn()} />)
    const sysDiv = container.querySelector('.my-2.rounded.px-3.py-2')
    expect(sysDiv).not.toBeNull()
    // hookEvent renders as a span
    const hookSpan = sysDiv!.querySelector('span')
    expect(hookSpan).not.toBeNull()
    expect(hookSpan!.textContent).toBe('PostToolUse')
    // content renders via MarkdownRenderer
    expect(sysDiv!.querySelector('[data-testid="markdown"]')).toHaveTextContent('Check result')
  })
})
