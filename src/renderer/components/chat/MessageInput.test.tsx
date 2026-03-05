const settingsMock: Record<string, string> = {}
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: { settings: Record<string, string> }) => unknown) =>
    selector({ settings: settingsMock }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MessageInput } from './MessageInput'

describe('MessageInput', () => {
  afterEach(() => {
    delete settingsMock['agent_name']
    delete settingsMock['ai_sdkBackend']
    delete settingsMock['sendOnEnter']
  })

  it('shows placeholder with @ hint when not disabled', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} isStreaming={false} />)
    expect(screen.getByPlaceholderText('Message Claude... (@ to mention files, / for commands)')).toBeInTheDocument()
  })

  it('shows configured agent name in placeholder', () => {
    settingsMock['agent_name'] = 'Hal'
    render(<MessageInput onSend={vi.fn()} disabled={false} isStreaming={false} />)
    expect(screen.getByPlaceholderText('Message Hal... (@ to mention files, / for commands)')).toBeInTheDocument()
  })

  it('shows backend display name in placeholder when no agent_name', () => {
    settingsMock['ai_sdkBackend'] = 'pi'
    render(<MessageInput onSend={vi.fn()} disabled={false} isStreaming={false} />)
    expect(screen.getByPlaceholderText('Message PI... (@ to mention files, / for commands)')).toBeInTheDocument()
  })

  it('shows "Sign in to start chatting..." when disabled', () => {
    render(<MessageInput onSend={vi.fn()} disabled={true} isStreaming={false} />)
    expect(screen.getByPlaceholderText('Sign in to start chatting...')).toBeInTheDocument()
  })

  it('calls onCanSendChange(false) when input is empty', () => {
    const onCanSendChange = vi.fn()
    render(<MessageInput onSend={vi.fn()} disabled={false} isStreaming={false} onCanSendChange={onCanSendChange} />)
    expect(onCanSendChange).toHaveBeenCalledWith(false)
  })

  it('calls onCanSendChange(false) when isStreaming', () => {
    const onCanSendChange = vi.fn()
    render(<MessageInput onSend={vi.fn()} disabled={false} isStreaming={true} onCanSendChange={onCanSendChange} />)
    expect(onCanSendChange).toHaveBeenCalledWith(false)
  })

  it('Enter key calls onSend with trimmed content', () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} disabled={false} isStreaming={false} />)

    const textarea = screen.getByPlaceholderText('Message Claude... (@ to mention files, / for commands)')
    fireEvent.change(textarea, { target: { value: '  hello world  ' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(onSend).toHaveBeenCalledWith('hello world')
  })

  it('Shift+Enter does not call onSend', () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} disabled={false} isStreaming={false} />)

    const textarea = screen.getByPlaceholderText('Message Claude... (@ to mention files, / for commands)')
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('Tab inserts a tab character when no dropdown is open', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} isStreaming={false} />)

    const textarea = screen.getByPlaceholderText('Message Claude... (@ to mention files, / for commands)') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello' } })
    // Place cursor at end
    textarea.selectionStart = textarea.selectionEnd = 5

    const prevented = !fireEvent.keyDown(textarea, { key: 'Tab' })

    expect(prevented).toBe(true)
    expect(textarea.value).toBe('hello\t')
    expect(textarea.selectionStart).toBe(6)
  })

  it('Tab inserts a tab character at cursor position mid-text', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} isStreaming={false} />)

    const textarea = screen.getByPlaceholderText('Message Claude... (@ to mention files, / for commands)') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'helloworld' } })
    // Place cursor between "hello" and "world"
    textarea.selectionStart = textarea.selectionEnd = 5

    fireEvent.keyDown(textarea, { key: 'Tab' })

    expect(textarea.value).toBe('hello\tworld')
    expect(textarea.selectionStart).toBe(6)
  })

  it('routes send to onQueue when isStreaming is true', () => {
    const onSend = vi.fn()
    const onQueue = vi.fn()
    render(
      <MessageInput
        onSend={onSend}
        onQueue={onQueue}
        disabled={false}
        isStreaming={true}
        hasQueuedMessages={false}
      />
    )

    const textarea = screen.getByLabelText('Message input')
    fireEvent.change(textarea, { target: { value: 'queued message' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(onQueue).toHaveBeenCalledWith('queued message')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('routes send to onQueue when hasQueuedMessages is true', () => {
    const onSend = vi.fn()
    const onQueue = vi.fn()
    render(
      <MessageInput
        onSend={onSend}
        onQueue={onQueue}
        disabled={false}
        isStreaming={false}
        hasQueuedMessages={true}
      />
    )

    const textarea = screen.getByLabelText('Message input')
    fireEvent.change(textarea, { target: { value: 'test message' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(onQueue).toHaveBeenCalledWith('test message')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('routes to onSend when not streaming and no queue', () => {
    const onSend = vi.fn()
    const onQueue = vi.fn()
    render(
      <MessageInput
        onSend={onSend}
        onQueue={onQueue}
        disabled={false}
        isStreaming={false}
        hasQueuedMessages={false}
      />
    )

    const textarea = screen.getByLabelText('Message input')
    fireEvent.change(textarea, { target: { value: 'direct message' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(onSend).toHaveBeenCalledWith('direct message')
    expect(onQueue).not.toHaveBeenCalled()
  })
})
