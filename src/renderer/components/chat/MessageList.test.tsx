vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: Record<string, string> }) => unknown) =>
    selector({ settings: { autoScroll: 'true', chatLayout: 'tight' } }),
}))

vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

vi.mock('./MessageBubble', () => ({
  MessageBubble: ({ message }: { message: { id: number; content: string } }) => (
    <div data-testid={`message-${message.id}`}>{message.content}</div>
  ),
}))

vi.mock('./StreamingIndicator', () => ({
  StreamingIndicator: () => <div data-testid="streaming-indicator" />,
}))

import { render, screen } from '@testing-library/react'
import { MessageList } from './MessageList'
import type { Message } from '../../../shared/types'

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 1,
  conversation_id: 1,
  role: 'user',
  content: 'Hello',
  attachments: '[]',
  tool_calls: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  ...overrides,
})

const defaultProps = {
  messages: [] as Message[],
  isStreaming: false,
  streamParts: [],
  streamingContent: '',
  isLoading: false,
  onEdit: vi.fn(),
  onRegenerate: vi.fn(),
  onFork: vi.fn(),
  onStopGeneration: vi.fn(),
}

describe('MessageList', () => {
  describe('ContextClearedDivider', () => {
    it('renders "Context cleared" divider when clearedAt is set and compactSummary is null', () => {
      const messages = [
        makeMessage({ id: 1, content: 'old msg', created_at: '2025-01-01T00:00:00Z' }),
        makeMessage({ id: 2, content: 'new msg', created_at: '2025-01-03T00:00:00Z' }),
      ]

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          clearedAt="2025-01-02T00:00:00Z"
          compactSummary={null}
        />,
      )

      expect(screen.getByText(/Context cleared/)).toBeInTheDocument()
    })

    it('shows message count in divider', () => {
      const messages = [
        makeMessage({ id: 1, content: 'old msg 1', created_at: '2025-01-01T00:00:00Z' }),
        makeMessage({ id: 2, content: 'old msg 2', created_at: '2025-01-01T01:00:00Z' }),
        makeMessage({ id: 3, content: 'new msg', created_at: '2025-01-03T00:00:00Z' }),
      ]

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          clearedAt="2025-01-02T00:00:00Z"
          compactSummary={null}
        />,
      )

      // The divider appears between msg 2 and msg 3, idx=2, so clearedCount=2
      expect(screen.getByText(/2 messages/)).toBeInTheDocument()
    })

    it('shows singular "message" for count of 1', () => {
      const messages = [
        makeMessage({ id: 1, content: 'old msg', created_at: '2025-01-01T00:00:00Z' }),
        makeMessage({ id: 2, content: 'new msg', created_at: '2025-01-03T00:00:00Z' }),
      ]

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          clearedAt="2025-01-02T00:00:00Z"
          compactSummary={null}
        />,
      )

      // idx=1 so clearedCount=1 => "1 message" (singular)
      expect(screen.getByText(/1 message(?!s)/)).toBeInTheDocument()
    })

    it('renders ContextClearedDivider at end when all messages are before clearedAt', () => {
      const messages = [
        makeMessage({ id: 1, content: 'old msg', created_at: '2025-01-01T00:00:00Z' }),
      ]

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          clearedAt="2025-01-02T00:00:00Z"
          compactSummary={null}
        />,
      )

      expect(screen.getByText(/Context cleared/)).toBeInTheDocument()
    })
  })

  describe('CompactSummaryBubble', () => {
    it('renders CompactSummaryBubble when compactSummary is present (between messages)', () => {
      const messages = [
        makeMessage({ id: 1, content: 'old msg', created_at: '2025-01-01T00:00:00Z' }),
        makeMessage({ id: 2, content: 'new msg', created_at: '2025-01-03T00:00:00Z' }),
      ]

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          clearedAt="2025-01-02T00:00:00Z"
          compactSummary="This is the compacted summary"
        />,
      )

      expect(screen.getByText(/\/compact/)).toBeInTheDocument()
      expect(screen.getByText('This is the compacted summary')).toBeInTheDocument()
    })

    it('shows message count in CompactSummaryBubble header', () => {
      const messages = [
        makeMessage({ id: 1, content: 'old 1', created_at: '2025-01-01T00:00:00Z' }),
        makeMessage({ id: 2, content: 'old 2', created_at: '2025-01-01T01:00:00Z' }),
        makeMessage({ id: 3, content: 'new', created_at: '2025-01-03T00:00:00Z' }),
      ]

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          clearedAt="2025-01-02T00:00:00Z"
          compactSummary="Summary text"
        />,
      )

      expect(screen.getByText(/2 messages compacted/)).toBeInTheDocument()
    })

    it('shows loading state when isCompacting is true (at end)', () => {
      const messages = [
        makeMessage({ id: 1, content: 'old msg', created_at: '2025-01-01T00:00:00Z' }),
      ]

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          clearedAt="2025-01-02T00:00:00Z"
          compactSummary={null}
          isCompacting={true}
        />,
      )

      expect(screen.getByText('Compacting conversation...')).toBeInTheDocument()
    })

    it('renders CompactSummaryBubble at end when all messages before clearedAt', () => {
      const messages = [
        makeMessage({ id: 1, content: 'old msg', created_at: '2025-01-01T00:00:00Z' }),
      ]

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          clearedAt="2025-01-02T00:00:00Z"
          compactSummary="End summary"
        />,
      )

      expect(screen.getByText(/\/compact/)).toBeInTheDocument()
      expect(screen.getByText('End summary')).toBeInTheDocument()
    })

    it('does not render compact or clear divider when clearedAt is not set', () => {
      const messages = [
        makeMessage({ id: 1, content: 'msg1', created_at: '2025-01-01T00:00:00Z' }),
      ]

      render(
        <MessageList
          {...defaultProps}
          messages={messages}
          clearedAt={null}
          compactSummary={null}
        />,
      )

      expect(screen.queryByText(/Context cleared/)).not.toBeInTheDocument()
      expect(screen.queryByText(/\/compact/)).not.toBeInTheDocument()
    })
  })
})
