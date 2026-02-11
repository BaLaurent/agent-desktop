import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AskUserBlock } from './AskUserBlock'
import type { StreamPart, AskUserQuestion } from '../../../shared/types'

type AskUserPart = Extract<StreamPart, { type: 'ask_user' }>

describe('AskUserBlock', () => {
  const questions: AskUserQuestion[] = [
    {
      question: 'Which library should we use?',
      header: 'Library',
      options: [
        { label: 'React', description: 'Popular UI library' },
        { label: 'Vue', description: 'Progressive framework' },
      ],
      multiSelect: false,
    },
  ]

  const baseAskUser: AskUserPart = {
    type: 'ask_user',
    requestId: 'req_456',
    questions,
  }

  it('renders question text and options', () => {
    render(<AskUserBlock askUser={baseAskUser} />)
    expect(screen.getByText('Which library should we use?')).toBeInTheDocument()
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('Vue')).toBeInTheDocument()
    expect(screen.getByText('Popular UI library')).toBeInTheDocument()
  })

  it('renders radio buttons for single-select', () => {
    render(<AskUserBlock askUser={baseAskUser} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
  })

  it('renders checkboxes for multi-select', () => {
    const multiQ: AskUserPart = {
      ...baseAskUser,
      questions: [{ ...questions[0], multiSelect: true }],
    }
    render(<AskUserBlock askUser={multiQ} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
  })

  it('calls respondToApproval with selected answers on submit', () => {
    render(<AskUserBlock askUser={baseAskUser} />)

    // Select "React"
    fireEvent.click(screen.getByText('React'))
    fireEvent.click(screen.getByText('Submit'))

    expect(window.agent.messages.respondToApproval).toHaveBeenCalledWith(
      'req_456',
      { answers: { Library: 'React' } }
    )
  })

  it('shows read-only summary after submission', () => {
    render(<AskUserBlock askUser={baseAskUser} />)
    fireEvent.click(screen.getByText('Vue'))
    fireEvent.click(screen.getByText('Submit'))

    expect(screen.getByText(/Answers submitted/)).toBeInTheDocument()
    expect(screen.getByText(/Library:/)).toBeInTheDocument()
    expect(screen.getByText(/Vue/)).toBeInTheDocument()
    expect(screen.queryByText('Submit')).not.toBeInTheDocument()
  })

  it('renders Other input field', () => {
    render(<AskUserBlock askUser={baseAskUser} />)
    expect(screen.getByPlaceholderText('Other...')).toBeInTheDocument()
  })

  it('renders header tag', () => {
    render(<AskUserBlock askUser={baseAskUser} />)
    expect(screen.getByText('Library')).toBeInTheDocument()
  })
})
