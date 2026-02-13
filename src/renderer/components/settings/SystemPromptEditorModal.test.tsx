vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="mock-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { SystemPromptEditorModal } from './SystemPromptEditorModal'

describe('SystemPromptEditorModal', () => {
  const defaultProps = {
    value: 'initial prompt',
    onChange: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders header text "Edit System Prompt"', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    expect(screen.getByText('Edit System Prompt')).toBeInTheDocument()
  })

  it('renders the editor with the initial value', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    const editor = screen.getByTestId('mock-editor') as HTMLTextAreaElement
    expect(editor.value).toBe('initial prompt')
  })

  it('Save button calls onChange with current value then onClose', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Save'))
    expect(defaultProps.onChange).toHaveBeenCalledWith('initial prompt')
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('Save calls onChange before onClose', () => {
    const callOrder: string[] = []
    const onChange = vi.fn(() => callOrder.push('onChange'))
    const onClose = vi.fn(() => callOrder.push('onClose'))
    render(<SystemPromptEditorModal value="test" onChange={onChange} onClose={onClose} />)
    fireEvent.click(screen.getByText('Save'))
    expect(callOrder).toEqual(['onChange', 'onClose'])
  })

  it('Cancel button calls onClose only, not onChange', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(defaultProps.onClose).toHaveBeenCalled()
    expect(defaultProps.onChange).not.toHaveBeenCalled()
  })

  it('Close (x) button calls onClose', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Close editor'))
    expect(defaultProps.onClose).toHaveBeenCalled()
    expect(defaultProps.onChange).not.toHaveBeenCalled()
  })

  it('Escape key calls onClose', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalled()
    expect(defaultProps.onChange).not.toHaveBeenCalled()
  })

  it('non-Escape keys do not trigger close', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('backdrop click calls onClose', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    // The backdrop is the outermost fixed div; clicking it directly triggers cancel
    const backdrop = screen.getByText('Edit System Prompt').closest('.fixed')!
    fireEvent.click(backdrop)
    expect(defaultProps.onClose).toHaveBeenCalled()
    expect(defaultProps.onChange).not.toHaveBeenCalled()
  })

  it('clicking inside the modal does not call onClose', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Edit System Prompt'))
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('editing the draft and saving reflects the new value', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    const editor = screen.getByTestId('mock-editor')
    fireEvent.change(editor, { target: { value: 'updated prompt' } })
    fireEvent.click(screen.getByText('Save'))
    expect(defaultProps.onChange).toHaveBeenCalledWith('updated prompt')
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('editing the draft and cancelling does not call onChange', () => {
    render(<SystemPromptEditorModal {...defaultProps} />)
    const editor = screen.getByTestId('mock-editor')
    fireEvent.change(editor, { target: { value: 'modified but cancelled' } })
    fireEvent.click(screen.getByText('Cancel'))
    expect(defaultProps.onChange).not.toHaveBeenCalled()
    expect(defaultProps.onClose).toHaveBeenCalled()
  })
})
