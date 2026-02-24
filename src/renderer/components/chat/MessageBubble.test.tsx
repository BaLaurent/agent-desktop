// ─── TTS and Settings store mocks ────────────────────────────
const ttsStoreMock = { speakingMessageId: null as number | null, playMessage: vi.fn(), stopPlayback: vi.fn() }
vi.mock('../../stores/ttsStore', () => ({
  useTtsStore: Object.assign(
    (selector?: (s: typeof ttsStoreMock) => unknown) => (selector ? selector(ttsStoreMock) : ttsStoreMock),
    { getState: () => ttsStoreMock, setState: (s: Partial<typeof ttsStoreMock>) => Object.assign(ttsStoreMock, s) },
  ),
}))

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: Record<string, string> }) => unknown) =>
    selector({ settings: { tts_provider: 'spd-say', tts_responseMode: 'full' } }),
}))

// ─── Component mocks ─────────────────────────────────────────
vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

vi.mock('../scheduler/TaskFormModal', () => ({
  TaskFormModal: (props: Record<string, unknown>) => (
    <div data-testid="task-form-modal" data-prompt={props.initialPrompt} data-conversation-id={props.initialConversationId} />
  ),
}))

import { render, screen, fireEvent } from '@testing-library/react'
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
  beforeEach(() => {
    ttsStoreMock.speakingMessageId = null
    ttsStoreMock.playMessage.mockClear()
    ttsStoreMock.stopPlayback.mockClear()
  })

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

  it('shows Schedule button on hover for user messages', () => {
    const { container } = render(<MessageBubble message={makeMessage({ role: 'user' })} isLast={false} />)
    fireEvent.mouseEnter(container.firstChild as Element)
    expect(screen.getByTitle('Schedule as recurring task')).toBeInTheDocument()
  })

  it('does not show Schedule button for assistant messages', () => {
    const { container } = render(<MessageBubble message={makeMessage({ role: 'assistant' })} isLast={false} />)
    fireEvent.mouseEnter(container.firstChild as Element)
    expect(screen.queryByTitle('Schedule as recurring task')).not.toBeInTheDocument()
  })

  it('opens TaskFormModal with message content on Schedule click', () => {
    const msg = makeMessage({ role: 'user', content: 'Do the thing', conversation_id: 42 })
    const { container } = render(<MessageBubble message={msg} isLast={false} />)
    fireEvent.mouseEnter(container.firstChild as Element)
    fireEvent.click(screen.getByTitle('Schedule as recurring task'))
    const modal = screen.getByTestId('task-form-modal')
    expect(modal).toBeInTheDocument()
    expect(modal).toHaveAttribute('data-prompt', 'Do the thing')
    expect(modal).toHaveAttribute('data-conversation-id', '42')
  })

  // ── TTS Play/Stop button tests ─────────────────────────────

  it('does not show Play button on user messages', () => {
    const { container } = render(<MessageBubble message={makeMessage({ role: 'user' })} isLast={false} />)
    fireEvent.mouseEnter(container.firstChild as Element)
    expect(screen.queryByTitle('Play TTS')).not.toBeInTheDocument()
  })

  it('shows Play button on assistant messages when TTS configured', () => {
    const { container } = render(<MessageBubble message={makeMessage({ role: 'assistant' })} isLast={false} />)
    fireEvent.mouseEnter(container.firstChild as Element)
    expect(screen.getByTitle('Play TTS')).toBeInTheDocument()
  })

  it('clicking Play calls playMessage', () => {
    const msg = makeMessage({ role: 'assistant', id: 10, conversation_id: 5, content: 'test content' })
    const { container } = render(<MessageBubble message={msg} isLast={false} />)
    fireEvent.mouseEnter(container.firstChild as Element)
    fireEvent.click(screen.getByTitle('Play TTS'))

    expect(ttsStoreMock.playMessage).toHaveBeenCalledWith(10, 'test content', 5)
  })

  it('shows Stop when speakingMessageId matches', () => {
    ttsStoreMock.speakingMessageId = 1

    render(<MessageBubble message={makeMessage({ role: 'assistant', id: 1 })} isLast={false} />)
    // Action bar should be visible without hover when speaking
    expect(screen.getByTitle('Stop TTS')).toBeInTheDocument()
    expect(screen.getByText('Stop')).toBeInTheDocument()
  })

  it('action bar visible without hover when message is speaking', () => {
    ttsStoreMock.speakingMessageId = 1

    // Don't hover — action bar should still be visible
    render(<MessageBubble message={makeMessage({ role: 'assistant', id: 1 })} isLast={false} />)
    expect(screen.getByTitle('Stop TTS')).toBeInTheDocument()
  })

  it('clicking Stop calls stopPlayback', () => {
    ttsStoreMock.speakingMessageId = 1

    render(<MessageBubble message={makeMessage({ role: 'assistant', id: 1 })} isLast={false} />)
    fireEvent.click(screen.getByTitle('Stop TTS'))

    expect(ttsStoreMock.stopPlayback).toHaveBeenCalled()
  })
})
