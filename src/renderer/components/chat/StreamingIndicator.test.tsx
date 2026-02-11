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
})
