import { render, screen, fireEvent } from '@testing-library/react'
import { ToolUseBlock } from './ToolUseBlock'
import type { StreamPart } from '../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

describe('ToolUseBlock', () => {
  it('renders tool name', () => {
    const tool: ToolPart = { type: 'tool', name: 'Bash', id: 'tool_1', status: 'running' }
    render(<ToolUseBlock tool={tool} />)
    expect(screen.getByText(/Bash/)).toBeInTheDocument()
  })

  it('shows spinner element when status is running', () => {
    const tool: ToolPart = { type: 'tool', name: 'Read', id: 'tool_2', status: 'running' }
    const { container } = render(<ToolUseBlock tool={tool} />)
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('does not show spinner when status is done', () => {
    const tool: ToolPart = { type: 'tool', name: 'Write', id: 'tool_3', status: 'done' }
    const { container } = render(<ToolUseBlock tool={tool} />)
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).not.toBeInTheDocument()
  })

  it('renders summary text when done and summary provided', () => {
    const tool: ToolPart = { type: 'tool', name: 'Glob', id: 'tool_4', status: 'done', summary: 'Found 3 files' }
    render(<ToolUseBlock tool={tool} />)
    expect(screen.getByText('Found 3 files')).toBeInTheDocument()
  })

  it('renders compact view when no input/output exists', () => {
    const tool: ToolPart = { type: 'tool', name: 'Bash', id: 'tool_5', status: 'done' }
    render(<ToolUseBlock tool={tool} />)
    // No toggle buttons should exist
    expect(screen.queryByText('Input')).not.toBeInTheDocument()
    expect(screen.queryByText('Output')).not.toBeInTheDocument()
  })

  it('shows Input toggle button when input exists', () => {
    const tool: ToolPart = {
      type: 'tool', name: 'Bash', id: 'tool_6', status: 'done',
      input: { command: 'npm test' },
      output: 'All tests pass',
    }
    render(<ToolUseBlock tool={tool} />)
    expect(screen.getByLabelText('Toggle tool input')).toBeInTheDocument()
  })

  it('shows Output toggle button when status is done and output exists', () => {
    const tool: ToolPart = {
      type: 'tool', name: 'Bash', id: 'tool_7', status: 'done',
      input: { command: 'npm test' },
      output: 'All tests pass',
    }
    render(<ToolUseBlock tool={tool} />)
    expect(screen.getByLabelText('Toggle tool output')).toBeInTheDocument()
  })

  it('expands input section when Input button is clicked', () => {
    const tool: ToolPart = {
      type: 'tool', name: 'Bash', id: 'tool_8', status: 'done',
      input: { command: 'npm test' },
      output: 'pass',
    }
    render(<ToolUseBlock tool={tool} />)

    // Input not visible initially
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Toggle tool input'))
    expect(screen.getByText(/"command"/)).toBeInTheDocument()
  })

  it('expands output section when Output button is clicked', () => {
    const tool: ToolPart = {
      type: 'tool', name: 'Bash', id: 'tool_9', status: 'done',
      input: { command: 'ls' },
      output: 'file1.ts\nfile2.ts',
    }
    render(<ToolUseBlock tool={tool} />)

    expect(screen.queryByText('file1.ts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Toggle tool output'))
    expect(screen.getByText(/file1\.ts/)).toBeInTheDocument()
  })
})
