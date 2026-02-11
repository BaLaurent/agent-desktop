vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

import { render, screen } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../../../shared/types'

beforeAll(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  conversation_id: 1,
  role: 'user',
  content: 'Hello there',
  attachments: '[]',
  tool_calls: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
})

describe('MessageBubble', () => {
  it('user message shows "You" label', () => {
    render(<MessageBubble message={makeMessage({ role: 'user' })} isLast={false} />)
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('assistant message shows "Claude" label', () => {
    render(<MessageBubble message={makeMessage({ role: 'assistant' })} isLast={false} />)
    expect(screen.getByText('Claude')).toBeInTheDocument()
  })

  it('user message content is rendered as text', () => {
    render(<MessageBubble message={makeMessage({ role: 'user', content: 'Hi there' })} isLast={false} />)
    expect(screen.getByText('Hi there')).toBeInTheDocument()
  })

  it('assistant message renders through MarkdownRenderer', () => {
    render(<MessageBubble message={makeMessage({ role: 'assistant', content: '**bold**' })} isLast={false} />)
    expect(screen.getByTestId('markdown')).toHaveTextContent('**bold**')
  })

  it('assistant message shows ToolCallsSection when tool_calls is present', () => {
    const toolCalls = JSON.stringify([
      { id: 't1', name: 'Bash', input: '{}', output: 'ok', status: 'done' },
      { id: 't2', name: 'Read', input: '{}', output: 'content', status: 'done' },
    ])
    render(<MessageBubble message={makeMessage({ role: 'assistant', tool_calls: toolCalls })} isLast={false} />)
    expect(screen.getByText(/2 tools used/)).toBeInTheDocument()
  })

  it('assistant message does not show ToolCallsSection when tool_calls is null', () => {
    render(<MessageBubble message={makeMessage({ role: 'assistant', tool_calls: null })} isLast={false} />)
    expect(screen.queryByText(/tools? used/)).not.toBeInTheDocument()
  })

  it('user message never shows ToolCallsSection even with tool_calls', () => {
    const toolCalls = JSON.stringify([{ id: 't1', name: 'Bash', input: '{}', output: 'ok', status: 'done' }])
    render(<MessageBubble message={makeMessage({ role: 'user', tool_calls: toolCalls })} isLast={false} />)
    expect(screen.queryByText(/tools? used/)).not.toBeInTheDocument()
  })
})
