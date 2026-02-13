import { render, screen, fireEvent } from '@testing-library/react'
import { MessageInput } from './MessageInput'

describe('MessageInput', () => {
  it('shows placeholder with @ hint when not disabled', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} isStreaming={false} />)
    expect(screen.getByPlaceholderText('Message Claude... (@ to mention files, / for commands)')).toBeInTheDocument()
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
})
