vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="mock-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

vi.mock('../../stores/fileExplorerStore', () => ({
  useFileExplorerStore: { getState: () => ({ saveFile: vi.fn() }) },
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { CodeEditorModal } from './CodeEditorModal'

describe('CodeEditorModal', () => {
  const defaultProps = {
    value: 'const x = 1',
    onChange: vi.fn(),
    onClose: vi.fn(),
    language: 'typescript' as string | null,
    filename: 'index.ts',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the filename in the header', () => {
    render(<CodeEditorModal {...defaultProps} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('renders the editor with the initial value', () => {
    render(<CodeEditorModal {...defaultProps} />)
    const editor = screen.getByTestId('mock-editor') as HTMLTextAreaElement
    expect(editor.value).toBe('const x = 1')
  })

  it('calls onChange when editor value changes', () => {
    render(<CodeEditorModal {...defaultProps} />)
    const editor = screen.getByTestId('mock-editor')
    fireEvent.change(editor, { target: { value: 'const x = 2' } })
    expect(defaultProps.onChange).toHaveBeenCalledWith('const x = 2')
  })

  it('Close (x) button calls onClose', () => {
    render(<CodeEditorModal {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Close editor'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('Escape key calls onClose', () => {
    render(<CodeEditorModal {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('non-Escape keys do not trigger close', () => {
    render(<CodeEditorModal {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('backdrop click calls onClose', () => {
    render(<CodeEditorModal {...defaultProps} />)
    const backdrop = screen.getByText('index.ts').closest('.fixed')!
    fireEvent.click(backdrop)
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('clicking inside the modal does not call onClose', () => {
    render(<CodeEditorModal {...defaultProps} />)
    fireEvent.click(screen.getByText('index.ts'))
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('has close button with correct aria-label', () => {
    render(<CodeEditorModal {...defaultProps} />)
    expect(screen.getByLabelText('Close editor')).toBeInTheDocument()
  })
})
