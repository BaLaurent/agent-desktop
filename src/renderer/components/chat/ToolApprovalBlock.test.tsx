import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ToolApprovalBlock } from './ToolApprovalBlock'
import type { StreamPart } from '../../../shared/types'

type ToolApprovalPart = Extract<StreamPart, { type: 'tool_approval' }>

describe('ToolApprovalBlock', () => {
  const baseApproval: ToolApprovalPart = {
    type: 'tool_approval',
    requestId: 'req_123',
    toolName: 'Bash',
    toolInput: { command: 'ls -la /tmp', description: 'List files' },
  }

  it('renders tool name and input fields', () => {
    render(<ToolApprovalBlock approval={baseApproval} />)
    expect(screen.getByText(/Bash/)).toBeInTheDocument()
    expect(screen.getByText(/command:/i)).toBeInTheDocument()
    expect(screen.getByText(/ls -la \/tmp/)).toBeInTheDocument()
    expect(screen.getByText(/description:/i)).toBeInTheDocument()
  })

  it('renders Allow and Deny buttons', () => {
    render(<ToolApprovalBlock approval={baseApproval} />)
    expect(screen.getByText('Allow')).toBeInTheDocument()
    expect(screen.getByText('Deny')).toBeInTheDocument()
  })

  it('calls respondToApproval with allow when Allow is clicked', () => {
    render(<ToolApprovalBlock approval={baseApproval} />)
    fireEvent.click(screen.getByText('Allow'))
    expect(window.agent.messages.respondToApproval).toHaveBeenCalledWith(
      'req_123',
      { behavior: 'allow' }
    )
  })

  it('calls respondToApproval with deny when Deny is clicked', () => {
    render(<ToolApprovalBlock approval={baseApproval} />)
    fireEvent.click(screen.getByText('Deny'))
    expect(window.agent.messages.respondToApproval).toHaveBeenCalledWith(
      'req_123',
      { behavior: 'deny' }
    )
  })

  it('shows Approved badge after allowing', () => {
    render(<ToolApprovalBlock approval={baseApproval} />)
    fireEvent.click(screen.getByText('Allow'))
    expect(screen.getByText(/Approved/)).toBeInTheDocument()
    expect(screen.queryByText('Allow')).not.toBeInTheDocument()
    expect(screen.queryByText('Deny')).not.toBeInTheDocument()
  })

  it('shows Denied badge after denying', () => {
    render(<ToolApprovalBlock approval={baseApproval} />)
    fireEvent.click(screen.getByText('Deny'))
    expect(screen.getByText(/Denied/)).toBeInTheDocument()
    expect(screen.queryByText('Allow')).not.toBeInTheDocument()
    expect(screen.queryByText('Deny')).not.toBeInTheDocument()
  })

  it('truncates long input values', () => {
    const longValue = 'x'.repeat(300)
    const approval: ToolApprovalPart = {
      ...baseApproval,
      toolInput: { data: longValue },
    }
    render(<ToolApprovalBlock approval={approval} />)
    // The truncated value should end with '...'
    const dataEl = screen.getByTitle(longValue)
    expect(dataEl).toBeInTheDocument()
    expect(dataEl.textContent).toContain('...')
  })
})
