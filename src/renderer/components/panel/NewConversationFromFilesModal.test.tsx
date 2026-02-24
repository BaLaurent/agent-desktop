import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NewConversationFromFilesModal } from './NewConversationFromFilesModal'

describe('NewConversationFromFilesModal', () => {
  const defaultProps = {
    paths: ['/home/user/project/src/index.ts', '/home/user/project/README.md'],
    onConfirm: vi.fn<(method: 'copy' | 'symlink') => Promise<void>>().mockResolvedValue(undefined),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with file list showing item count and basenames', () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    expect(screen.getByText('New conversation with 2 items')).toBeInTheDocument()
    expect(screen.getByText('index.ts')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('shows singular "item" for a single file', () => {
    render(<NewConversationFromFilesModal {...defaultProps} paths={['/home/user/file.txt']} />)
    expect(screen.getByText('New conversation with 1 item')).toBeInTheDocument()
  })

  it('defaults to copy method with correct description', () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    const select = screen.getByDisplayValue('Copy')
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Independent copies in session folder')).toBeInTheDocument()
  })

  it('can switch to symlink method and shows correct description', () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'symlink' } })
    expect(screen.getByText('Live links to original files')).toBeInTheDocument()
  })

  it('calls onConfirm with copy method by default', async () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => {
      expect(defaultProps.onConfirm).toHaveBeenCalledWith('copy')
    })
  })

  it('calls onConfirm with symlink when selected', async () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'symlink' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => {
      expect(defaultProps.onConfirm).toHaveBeenCalledWith('symlink')
    })
  })

  it('calls onClose after successful confirm', async () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  it('closes on Cancel click', () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('closes on Escape key', () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('shows error on confirm failure', async () => {
    defaultProps.onConfirm.mockRejectedValueOnce(new Error('Disk full'))
    render(<NewConversationFromFilesModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Disk full')
    })
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('shows fallback error for non-Error rejections', async () => {
    defaultProps.onConfirm.mockRejectedValueOnce('something')
    render(<NewConversationFromFilesModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to create conversation')
    })
  })

  it('shows loading state while onConfirm is pending', async () => {
    let resolve!: () => void
    defaultProps.onConfirm.mockReturnValueOnce(new Promise<void>((r) => { resolve = r }))
    render(<NewConversationFromFilesModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Create'))
    expect(screen.getByText('Creating...')).toBeInTheDocument()
    expect(screen.getByText('Creating...')).toBeDisabled()
    expect(screen.getByText('Cancel')).toBeDisabled()
    resolve()
    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled()
    })
  })

  it('has correct dialog role and aria-label', () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'New conversation from files')
  })

  it('backdrop click calls onClose', () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    const backdrop = screen.getByRole('dialog')
    fireEvent.click(backdrop)
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('clicking inside the modal does not call onClose', () => {
    render(<NewConversationFromFilesModal {...defaultProps} />)
    fireEvent.click(screen.getByText('index.ts'))
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })
})
