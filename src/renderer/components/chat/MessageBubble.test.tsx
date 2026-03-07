// ─── TTS and Settings store mocks ────────────────────────────
const ttsStoreMock = { speakingMessageId: null as number | null, playMessage: vi.fn(), stopPlayback: vi.fn() }
vi.mock('../../stores/ttsStore', () => ({
  useTtsStore: Object.assign(
    (selector?: (s: typeof ttsStoreMock) => unknown) => (selector ? selector(ttsStoreMock) : ttsStoreMock),
    { getState: () => ttsStoreMock, setState: (s: Partial<typeof ttsStoreMock>) => Object.assign(ttsStoreMock, s) },
  ),
}))

const settingsMock: Record<string, string> = { tts_provider: 'spd-say', tts_responseMode: 'full' }
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: Record<string, string> }) => unknown) =>
    selector({ settings: settingsMock }),
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

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
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

  it('assistant message shows configured agent name', () => {
    settingsMock['agent_name'] = 'Jarvis'
    render(<MessageBubble message={makeMessage({ role: 'assistant' })} isLast={false} />)
    expect(screen.getByText('Jarvis')).toBeInTheDocument()
    delete settingsMock['agent_name']
  })

  it('assistant message shows backend display name when no agent_name', () => {
    settingsMock['ai_sdkBackend'] = 'pi'
    render(<MessageBubble message={makeMessage({ role: 'assistant' })} isLast={false} />)
    expect(screen.getByText('PI')).toBeInTheDocument()
    delete settingsMock['ai_sdkBackend']
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

  it('hides Play button when effectiveTtsResponseMode overrides global to off', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant' })} isLast={false} effectiveTtsResponseMode="off" />,
    )
    fireEvent.mouseEnter(container.firstChild as Element)
    expect(screen.queryByTitle('Play TTS')).not.toBeInTheDocument()
  })

  it('shows Play button when effectiveTtsResponseMode overrides global', () => {
    const origMode = settingsMock.tts_responseMode
    settingsMock.tts_responseMode = 'off'
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant' })} isLast={false} effectiveTtsResponseMode="full" />,
    )
    fireEvent.mouseEnter(container.firstChild as Element)
    expect(screen.getByTitle('Play TTS')).toBeInTheDocument()
    settingsMock.tts_responseMode = origMode
  })

  // ── Edit mode tests ─────────────────────────────────────────

  const enterEditMode = (container: HTMLElement) => {
    fireEvent.mouseEnter(container.firstChild as Element)
    fireEvent.click(screen.getByTitle('Edit'))
  }

  it('bubble has w-full class when editing', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    // The bubble div is the second-level child (first child of the flex wrapper)
    const bubble = (container.firstChild as HTMLElement).firstChild as HTMLElement
    expect(bubble.className).toContain('w-full')
  })

  it('bubble does not have w-full class when not editing', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} onEdit={onEdit} />,
    )

    const bubble = (container.firstChild as HTMLElement).firstChild as HTMLElement
    expect(bubble.className).not.toContain('w-full')
  })

  it('textarea rows defaults to 3 for short single-line content', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', content: 'short' })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    // 'short' has 1 line → split('\n').length + 1 = 2, Math.max(3, 2) = 3
    expect(textarea.rows).toBe(3)
  })

  it('textarea rows grows with multiline content', () => {
    const multiline = 'line1\nline2\nline3\nline4\nline5'
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', content: multiline })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    // 5 lines → split('\n').length + 1 = 6, Math.max(3, 6) = 6
    expect(textarea.rows).toBe(6)
  })

  it('textarea rows updates dynamically when content is edited', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', content: 'short' })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.rows).toBe(3)

    // Simulate typing multiline content
    fireEvent.change(textarea, { target: { value: 'a\nb\nc\nd\ne\nf' } })
    // 6 lines → split('\n').length + 1 = 7, Math.max(3, 7) = 7
    expect(textarea.rows).toBe(7)
  })

  // ── Edit mode keyboard shortcut tests ──────────────────────

  it('Enter saves edit when sendOnEnter is true (default)', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', id: 1, content: 'original' })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'edited' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onEdit).toHaveBeenCalledWith(1, 'edited')
  })

  it('Shift+Enter does NOT save edit (inserts newline)', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(onEdit).not.toHaveBeenCalled()
    // Should still be in edit mode
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('Ctrl+Enter saves edit when sendOnEnter is false', () => {
    settingsMock.sendOnEnter = 'false'
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', id: 2, content: 'original' })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'ctrl-edited' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    expect(onEdit).toHaveBeenCalledWith(2, 'ctrl-edited')
    delete settingsMock.sendOnEnter
  })

  it('plain Enter does NOT save when sendOnEnter is false', () => {
    settingsMock.sendOnEnter = 'false'
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    delete settingsMock.sendOnEnter
  })

  it('Escape cancels edit mode', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', content: 'original' })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'unsaved changes' } })
    fireEvent.keyDown(textarea, { key: 'Escape' })

    // Should exit edit mode without saving
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  // ── Context menu tests ──────────────────────────────────────

  /** Right-click the inner bubble div (the one with onContextMenu) */
  const rightClickBubble = (container: HTMLElement) => {
    const bubble = (container.firstChild as HTMLElement).firstChild as HTMLElement
    fireEvent.contextMenu(bubble, { clientX: 100, clientY: 200 })
  }

  it('right-click opens context menu with correct items for user messages', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} onEdit={onEdit} />,
    )
    rightClickBubble(container)

    const menu = screen.getByRole('menu', { name: 'Message actions' })
    expect(menu).toBeInTheDocument()

    const items = screen.getAllByRole('menuitem')
    const labels = items.map((el) => el.textContent)
    expect(labels).toContain('Copy Message')
    expect(labels).toContain('Edit')
    expect(labels).toContain('Retry')
    expect(labels).toContain('Schedule')
  })

  it('right-click opens context menu with correct items for assistant messages', () => {
    const onRegenerate = vi.fn()
    const { container } = render(
      <MessageBubble
        message={makeMessage({ role: 'assistant' })}
        isLast={true}
        onRegenerate={onRegenerate}
      />,
    )
    rightClickBubble(container)

    const menu = screen.getByRole('menu', { name: 'Message actions' })
    expect(menu).toBeInTheDocument()

    const items = screen.getAllByRole('menuitem')
    const labels = items.map((el) => el.textContent)
    expect(labels).toContain('Copy Message')
    expect(labels).toContain('Play TTS')
    expect(labels).toContain('Retry')
    expect(labels).not.toContain('Edit')
    expect(labels).not.toContain('Schedule')
  })

  it('context menu does not show Retry for non-last assistant message', () => {
    const onRegenerate = vi.fn()
    const { container } = render(
      <MessageBubble
        message={makeMessage({ role: 'assistant' })}
        isLast={false}
        onRegenerate={onRegenerate}
      />,
    )
    rightClickBubble(container)

    const items = screen.getAllByRole('menuitem')
    const labels = items.map((el) => el.textContent)
    expect(labels).not.toContain('Retry')
  })

  it('context menu Copy calls clipboard writeText', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', content: 'copy me' })} isLast={false} />,
    )
    rightClickBubble(container)

    const copyBtn = screen.getAllByRole('menuitem').find((el) => el.textContent === 'Copy Message')!
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy me')
  })

  it('context menu Edit calls handleStartEdit for user messages', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} onEdit={onEdit} />,
    )
    rightClickBubble(container)

    const editBtn = screen.getAllByRole('menuitem').find((el) => el.textContent === 'Edit')!
    fireEvent.click(editBtn)

    // Editing mode should be active — textarea visible
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('context menu Retry calls onRegenerate for assistant messages', () => {
    const onRegenerate = vi.fn()
    const { container } = render(
      <MessageBubble
        message={makeMessage({ role: 'assistant' })}
        isLast={true}
        onRegenerate={onRegenerate}
      />,
    )
    rightClickBubble(container)

    const retryBtn = screen.getAllByRole('menuitem').find((el) => el.textContent === 'Retry')!
    fireEvent.click(retryBtn)

    expect(onRegenerate).toHaveBeenCalled()
  })

  it('context menu closes on outside click', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} />,
    )
    rightClickBubble(container)
    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeInTheDocument()

    // Click outside the context menu
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument()
  })

  it('context menu does not open during editing', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} onEdit={onEdit} />,
    )
    enterEditMode(container)

    // Verify we are in editing mode
    expect(screen.getByRole('textbox')).toBeInTheDocument()

    // Right-click should not open context menu
    rightClickBubble(container)
    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument()
  })

  it('context menu shows Stop TTS when message is speaking', () => {
    ttsStoreMock.speakingMessageId = 1

    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant', id: 1 })} isLast={false} />,
    )
    rightClickBubble(container)

    const items = screen.getAllByRole('menuitem')
    const labels = items.map((el) => el.textContent)
    expect(labels).toContain('Stop TTS')
    expect(labels).not.toContain('Play TTS')
  })

  it('context menu closes after clicking an action', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', content: 'test' })} isLast={false} />,
    )
    rightClickBubble(container)
    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeInTheDocument()

    const copyBtn = screen.getAllByRole('menuitem').find((el) => el.textContent === 'Copy Message')!
    fireEvent.click(copyBtn)

    expect(screen.queryByRole('menu', { name: 'Message actions' })).not.toBeInTheDocument()
  })

  it('context menu does not show Edit without onEdit prop', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} />,
    )
    rightClickBubble(container)

    const items = screen.getAllByRole('menuitem')
    const labels = items.map((el) => el.textContent)
    expect(labels).not.toContain('Edit')
  })

  // ── Retry tests (user messages) ──────────────────────────────

  it('shows Retry hover button for user messages with onEdit', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} onEdit={onEdit} />,
    )
    fireEvent.mouseEnter(container.firstChild as Element)
    expect(screen.getByTitle('Retry this message')).toBeInTheDocument()
  })

  it('does not show Retry hover button for user messages without onEdit', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} />,
    )
    fireEvent.mouseEnter(container.firstChild as Element)
    expect(screen.queryByTitle('Retry this message')).not.toBeInTheDocument()
  })

  it('Retry hover button calls onEdit with same content', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', id: 5, content: 'hello world' })} isLast={false} onEdit={onEdit} />,
    )
    fireEvent.mouseEnter(container.firstChild as Element)
    fireEvent.click(screen.getByTitle('Retry this message'))
    expect(onEdit).toHaveBeenCalledWith(5, 'hello world')
  })

  it('context menu Retry calls onEdit with same content for user messages', () => {
    const onEdit = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', id: 9, content: 'retry me' })} isLast={false} onEdit={onEdit} />,
    )
    rightClickBubble(container)

    const retryBtn = screen.getAllByRole('menuitem').find((el) => el.textContent === 'Retry')!
    expect(retryBtn).toBeDefined()
    fireEvent.click(retryBtn)
    expect(onEdit).toHaveBeenCalledWith(9, 'retry me')
  })

  it('context menu does not show Retry for user messages without onEdit', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} isLast={false} />,
    )
    rightClickBubble(container)

    const items = screen.getAllByRole('menuitem')
    const labels = items.map((el) => el.textContent)
    expect(labels).not.toContain('Retry')
  })

  // ── Fork context menu tests ───────────────────────────────────

  it('shows Fork in context menu and calls onFork with message id', () => {
    const onFork = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', id: 42 })} isLast={false} onFork={onFork} />,
    )
    rightClickBubble(container)

    const forkBtn = screen.getAllByRole('menuitem').find((el) => el.textContent === 'Fork from here')!
    expect(forkBtn).toBeDefined()
    fireEvent.click(forkBtn)
    expect(onFork).toHaveBeenCalledWith(42)
  })

  it('shows Fork in context menu for assistant messages too', () => {
    const onFork = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant', id: 7 })} isLast={false} onFork={onFork} />,
    )
    rightClickBubble(container)

    const forkBtn = screen.getAllByRole('menuitem').find((el) => el.textContent === 'Fork from here')!
    expect(forkBtn).toBeDefined()
    fireEvent.click(forkBtn)
    expect(onFork).toHaveBeenCalledWith(7)
  })

  // ── Hook system message extraction tests ─────────────────────

  it('extracts hook-system-message tags from assistant content', () => {
    const content = '<hook-system-message>Lint passed</hook-system-message>\nHere is the result'
    render(<MessageBubble message={makeMessage({ role: 'assistant', content })} isLast={false} />)
    // Hook message rendered in its own box
    expect(screen.getByText('Lint passed')).toBeInTheDocument()
    // Clean content rendered separately
    expect(screen.getByText('Here is the result')).toBeInTheDocument()
  })

  it('renders multiple hook messages in separate boxes', () => {
    const content = '<hook-system-message>Hook A</hook-system-message>\n<hook-system-message>Hook B</hook-system-message>\nMain content'
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant', content })} isLast={false} />,
    )
    expect(screen.getByText('Hook A')).toBeInTheDocument()
    expect(screen.getByText('Hook B')).toBeInTheDocument()
    expect(screen.getByText('Main content')).toBeInTheDocument()
    // Each hook message gets its own styled box
    const hookBoxes = container.querySelectorAll('.mb-2.rounded.px-3.py-2.text-xs.border')
    expect(hookBoxes).toHaveLength(2)
  })

  it('hook messages render through MarkdownRenderer', () => {
    const content = '<hook-system-message>**bold hook**</hook-system-message>\nNormal text'
    render(<MessageBubble message={makeMessage({ role: 'assistant', content })} isLast={false} />)
    // MarkdownRenderer mock renders data-testid="markdown"
    const markdowns = screen.getAllByTestId('markdown')
    const hookMarkdown = markdowns.find((el) => el.textContent === '**bold hook**')
    expect(hookMarkdown).toBeDefined()
  })

  it('does not extract hook tags from user messages', () => {
    const content = '<hook-system-message>Should not extract</hook-system-message>\nUser text'
    render(<MessageBubble message={makeMessage({ role: 'user', content })} isLast={false} />)
    // User messages render raw content including the tag text
    const markdown = screen.getByTestId('markdown')
    expect(markdown.textContent).toContain('<hook-system-message>')
  })

  it('cleanContent strips leading newlines after tag removal', () => {
    const content = '<hook-system-message>Hook msg</hook-system-message>\n\n\nActual response'
    render(<MessageBubble message={makeMessage({ role: 'assistant', content })} isLast={false} />)
    // The clean content MarkdownRenderer should get 'Actual response' (no leading newlines)
    const markdowns = screen.getAllByTestId('markdown')
    const mainContent = markdowns.find((el) => el.textContent === 'Actual response')
    expect(mainContent).toBeDefined()
  })

  it('copy uses cleanContent for assistant messages with hook tags', async () => {
    const content = '<hook-system-message>Hook info</hook-system-message>\nClean text only'
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant', content })} isLast={false} />,
    )
    fireEvent.mouseEnter(container.firstChild as Element)
    fireEvent.click(screen.getByTitle('Copy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Clean text only')
  })

  it('copy uses raw content for user messages (no hook stripping)', async () => {
    const content = 'Hello with <hook-system-message>tag</hook-system-message>'
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', content })} isLast={false} />,
    )
    fireEvent.mouseEnter(container.firstChild as Element)
    fireEvent.click(screen.getByTitle('Copy'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(content)
  })

  it('TTS playMessage uses cleanContent for assistant messages', () => {
    const content = '<hook-system-message>Hook data</hook-system-message>\nSpeakable text'
    const msg = makeMessage({ role: 'assistant', id: 20, conversation_id: 3, content })
    const { container } = render(<MessageBubble message={msg} isLast={false} />)
    fireEvent.mouseEnter(container.firstChild as Element)
    fireEvent.click(screen.getByTitle('Play TTS'))
    expect(ttsStoreMock.playMessage).toHaveBeenCalledWith(20, 'Speakable text', 3)
  })

  it('assistant message without hook tags renders normally', () => {
    render(
      <MessageBubble message={makeMessage({ role: 'assistant', content: 'Plain response' })} isLast={false} />,
    )
    const markdowns = screen.getAllByTestId('markdown')
    expect(markdowns.some((el) => el.textContent === 'Plain response')).toBe(true)
  })

  it('context menu copy uses cleanContent for assistant with hooks', () => {
    const content = '<hook-system-message>ctx hook</hook-system-message>\nContext clean text'
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant', content })} isLast={false} />,
    )
    rightClickBubble(container)
    const copyBtn = screen.getAllByRole('menuitem').find((el) => el.textContent === 'Copy Message')!
    fireEvent.click(copyBtn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Context clean text')
  })
})
