import { render, screen, fireEvent } from '@testing-library/react'
import { QueuePanel } from './QueuePanel'
import type { QueuedMessage } from '../../stores/chatStore'

describe('QueuePanel', () => {
  const mockMessages: QueuedMessage[] = [
    { id: 'q1', content: 'First message', createdAt: 1 },
    { id: 'q2', content: 'Second message', createdAt: 2 },
  ]

  const defaultProps = {
    messages: mockMessages,
    paused: false,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    onClear: vi.fn(),
    onResume: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders message count', () => {
    render(<QueuePanel {...defaultProps} />)
    expect(screen.getByText(/Queue \(2\)/)).toBeInTheDocument()
  })

  it('renders all queued messages', () => {
    render(<QueuePanel {...defaultProps} />)
    expect(screen.getByText('First message')).toBeInTheDocument()
    expect(screen.getByText('Second message')).toBeInTheDocument()
  })

  it('shows Resume button when paused', () => {
    render(<QueuePanel {...defaultProps} paused={true} />)
    expect(screen.getByText(/Resume/)).toBeInTheDocument()
  })

  it('does not show Resume button when not paused', () => {
    render(<QueuePanel {...defaultProps} paused={false} />)
    expect(screen.queryByText(/Resume/)).not.toBeInTheDocument()
  })

  it('calls onClear when Clear button clicked', () => {
    const onClear = vi.fn()
    render(<QueuePanel {...defaultProps} onClear={onClear} />)

    fireEvent.click(screen.getByLabelText('Clear queue'))
    expect(onClear).toHaveBeenCalled()
  })

  it('calls onResume when Resume button clicked', () => {
    const onResume = vi.fn()
    render(<QueuePanel {...defaultProps} paused={true} onResume={onResume} />)

    fireEvent.click(screen.getByText(/Resume/))
    expect(onResume).toHaveBeenCalled()
  })

  it('returns null when messages array is empty', () => {
    const { container } = render(<QueuePanel {...defaultProps} messages={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
