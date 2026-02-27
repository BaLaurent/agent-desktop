import { render, screen, fireEvent } from '@testing-library/react'
import { QueueItem } from './QueueItem'

describe('QueueItem', () => {
  const defaultProps = {
    id: 'q1',
    content: 'Fix the login bug in the auth module',
    index: 0,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDragStart: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders truncated content', () => {
    render(<QueueItem {...defaultProps} />)
    expect(screen.getByText(/Fix the login bug/)).toBeInTheDocument()
  })

  it('calls onDelete when delete button clicked', () => {
    const onDelete = vi.fn()
    render(<QueueItem {...defaultProps} onDelete={onDelete} />)

    fireEvent.click(screen.getByLabelText('Delete queued message'))
    expect(onDelete).toHaveBeenCalledWith('q1')
  })

  it('enters edit mode and saves on Enter', () => {
    const onEdit = vi.fn()
    render(<QueueItem {...defaultProps} onEdit={onEdit} />)

    fireEvent.click(screen.getByLabelText('Edit queued message'))

    const input = screen.getByDisplayValue('Fix the login bug in the auth module')
    fireEvent.change(input, { target: { value: 'Updated content' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onEdit).toHaveBeenCalledWith('q1', 'Updated content')
  })

  it('exits edit mode on Escape without saving', () => {
    const onEdit = vi.fn()
    render(<QueueItem {...defaultProps} onEdit={onEdit} />)

    fireEvent.click(screen.getByLabelText('Edit queued message'))
    fireEvent.keyDown(screen.getByDisplayValue('Fix the login bug in the auth module'), { key: 'Escape' })

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText(/Fix the login bug/)).toBeInTheDocument()
  })
})
