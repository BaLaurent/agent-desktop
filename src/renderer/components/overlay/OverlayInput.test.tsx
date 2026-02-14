import { render, screen, fireEvent } from '@testing-library/react'
import { OverlayInput } from './OverlayInput'

describe('OverlayInput', () => {
  const defaultProps = {
    onSend: vi.fn(),
    isStreaming: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the input field with correct placeholder', () => {
    render(<OverlayInput {...defaultProps} />)
    expect(screen.getByPlaceholderText('Ask anything...')).toBeInTheDocument()
  })

  it('renders input with aria-label "Quick chat input"', () => {
    render(<OverlayInput {...defaultProps} />)
    expect(screen.getByLabelText('Quick chat input')).toBeInTheDocument()
  })

  it('calls onSend with trimmed text when Enter is pressed', () => {
    render(<OverlayInput {...defaultProps} />)
    const input = screen.getByLabelText('Quick chat input')
    fireEvent.change(input, { target: { value: '  hello world  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(defaultProps.onSend).toHaveBeenCalledWith('hello world')
  })

  it('clears the input after sending', () => {
    render(<OverlayInput {...defaultProps} />)
    const input = screen.getByLabelText('Quick chat input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('')
  })

  it('does not call onSend on Shift+Enter', () => {
    render(<OverlayInput {...defaultProps} />)
    const input = screen.getByLabelText('Quick chat input')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(defaultProps.onSend).not.toHaveBeenCalled()
  })

  it('does not call onSend when input is empty or whitespace', () => {
    render(<OverlayInput {...defaultProps} />)
    const input = screen.getByLabelText('Quick chat input')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(defaultProps.onSend).not.toHaveBeenCalled()
  })

  it('disables the input when isStreaming is true', () => {
    render(<OverlayInput {...defaultProps} isStreaming={true} />)
    const input = screen.getByLabelText('Quick chat input')
    expect(input).toBeDisabled()
  })

  it('does not call onSend when isStreaming is true', () => {
    render(<OverlayInput {...defaultProps} isStreaming={true} />)
    const input = screen.getByLabelText('Quick chat input')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(defaultProps.onSend).not.toHaveBeenCalled()
  })

  it('shows spinner when isStreaming is true', () => {
    const { container } = render(<OverlayInput {...defaultProps} isStreaming={true} />)
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('does not show spinner when isStreaming is false', () => {
    const { container } = render(<OverlayInput {...defaultProps} isStreaming={false} />)
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).not.toBeInTheDocument()
  })
})
