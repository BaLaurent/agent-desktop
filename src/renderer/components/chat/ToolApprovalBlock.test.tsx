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

  it('renders the plan as Markdown for ExitPlanMode approvals', () => {
    const approval: ToolApprovalPart = {
      type: 'tool_approval',
      requestId: 'req_plan',
      toolName: 'ExitPlanMode',
      toolInput: { plan: '# Heading\n\n- step one\n- step two' },
    }
    render(<ToolApprovalBlock approval={approval} />)
    expect(screen.getByText(/Plan ready/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('step one')).toBeInTheDocument()
    expect(screen.getByText('step two')).toBeInTheDocument()
    expect(screen.queryByText(/^plan:/i)).not.toBeInTheDocument()
  })

  it('ExitPlanMode shows a feedback textarea and revise/approve buttons', () => {
    const approval: ToolApprovalPart = {
      type: 'tool_approval',
      requestId: 'req_plan',
      toolName: 'ExitPlanMode',
      toolInput: { plan: 'Do X then Y' },
    }
    render(<ToolApprovalBlock approval={approval} />)
    expect(screen.getByLabelText(/Feedback/i)).toBeInTheDocument()
    expect(screen.getByText('Approve & proceed')).toBeInTheDocument()
    expect(screen.getByText('Reject & revise')).toBeInTheDocument()
  })

  it('ExitPlanMode reject with feedback sends the message to the agent', () => {
    const approval: ToolApprovalPart = {
      type: 'tool_approval',
      requestId: 'req_plan',
      toolName: 'ExitPlanMode',
      toolInput: { plan: 'Do X then Y' },
    }
    render(<ToolApprovalBlock approval={approval} />)
    fireEvent.change(screen.getByLabelText(/Feedback/i), {
      target: { value: 'Please add a rollback step' },
    })
    fireEvent.click(screen.getByText('Reject & revise'))
    expect(window.agent.messages.respondToApproval).toHaveBeenCalledWith('req_plan', {
      behavior: 'deny',
      message: 'Please add a rollback step',
    })
  })

  it('ExitPlanMode reject without feedback sends a default revise message', () => {
    const approval: ToolApprovalPart = {
      type: 'tool_approval',
      requestId: 'req_plan',
      toolName: 'ExitPlanMode',
      toolInput: { plan: 'Do X then Y' },
    }
    render(<ToolApprovalBlock approval={approval} />)
    fireEvent.click(screen.getByText('Reject & revise'))
    expect(window.agent.messages.respondToApproval).toHaveBeenCalledWith('req_plan', {
      behavior: 'deny',
      message: 'User rejected the plan — please revise it.',
    })
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

  it('renders the "Don\'t ask again" checkbox for a normal tool and passes dontAskAgain:true when checked before Allow', () => {
    render(<ToolApprovalBlock approval={baseApproval} />)
    const checkbox = screen.getByRole('checkbox', {
      name: /Don't ask again for the Bash tool/i,
    })
    expect(checkbox).toBeInTheDocument()
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByText('Allow'))
    expect(window.agent.messages.respondToApproval).toHaveBeenCalledWith('req_123', {
      behavior: 'allow',
      dontAskAgain: true,
    })
  })

  it('omits dontAskAgain when Allow is clicked without checking the checkbox', () => {
    render(<ToolApprovalBlock approval={baseApproval} />)
    fireEvent.click(screen.getByText('Allow'))
    expect(window.agent.messages.respondToApproval).toHaveBeenCalledWith('req_123', {
      behavior: 'allow',
    })
  })

  it('does not render the "Don\'t ask again" checkbox for ExitPlanMode approvals', () => {
    const approval: ToolApprovalPart = {
      type: 'tool_approval',
      requestId: 'req_plan',
      toolName: 'ExitPlanMode',
      toolInput: { plan: 'Do X then Y' },
    }
    render(<ToolApprovalBlock approval={approval} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
