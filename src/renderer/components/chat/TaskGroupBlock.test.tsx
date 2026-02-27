vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { TaskGroupBlock } from './TaskGroupBlock'
import type { StreamPart } from '../../../shared/types'

type ToolPart = Extract<StreamPart, { type: 'tool' }>

const makeTask = (
  id: string,
  status: 'running' | 'done' = 'running',
  name = 'Task',
  extra?: Partial<ToolPart>,
): ToolPart => ({
  type: 'tool', name, id, status, ...extra,
})

describe('TaskGroupBlock', () => {
  it('renders header with task count', () => {
    const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')]
    render(<TaskGroupBlock tasks={tasks} />)
    expect(screen.getByText(/3 sub-agents/)).toBeInTheDocument()
  })

  it('shows spinner when any task is running', () => {
    const tasks = [makeTask('t1', 'running'), makeTask('t2', 'done')]
    const { container } = render(<TaskGroupBlock tasks={tasks} />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows no spinner when all tasks are done', () => {
    const tasks = [makeTask('t1', 'done'), makeTask('t2', 'done')]
    const { container } = render(<TaskGroupBlock tasks={tasks} />)
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument()
  })

  it('renders all task names', () => {
    const tasks = [
      makeTask('t1', 'done', 'AlphaTask'),
      makeTask('t2', 'done', 'BetaTask'),
      makeTask('t3', 'done', 'GammaTask'),
    ]
    render(<TaskGroupBlock tasks={tasks} />)
    expect(screen.getByText(/AlphaTask/)).toBeInTheDocument()
    expect(screen.getByText(/BetaTask/)).toBeInTheDocument()
    expect(screen.getByText(/GammaTask/)).toBeInTheDocument()
  })

  it('is expanded by default', () => {
    const tasks = [makeTask('t1', 'done', 'VisibleTask')]
    render(<TaskGroupBlock tasks={tasks} />)
    expect(screen.getByText(/VisibleTask/)).toBeInTheDocument()
  })

  it('cannot collapse while any task is running', () => {
    const tasks = [makeTask('t1', 'running', 'RunningTask')]
    render(<TaskGroupBlock tasks={tasks} />)

    const header = screen.getByLabelText(/sub-agent/)
    fireEvent.click(header)

    // Tasks still visible — collapse blocked
    expect(screen.getByText(/RunningTask/)).toBeInTheDocument()
  })

  it('can collapse and re-expand when all tasks are done', () => {
    const tasks = [makeTask('t1', 'done', 'DoneTask')]
    render(<TaskGroupBlock tasks={tasks} />)

    const header = screen.getByLabelText(/sub-agent/)

    // Collapse
    fireEvent.click(header)
    expect(screen.queryByText(/DoneTask/)).not.toBeInTheDocument()

    // Re-expand
    fireEvent.click(header)
    expect(screen.getByText(/DoneTask/)).toBeInTheDocument()
  })

  it('has accent border styling on the container', () => {
    const tasks = [makeTask('t1', 'done')]
    const { container } = render(<TaskGroupBlock tasks={tasks} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.style.borderLeft).toBe('3px solid var(--color-accent)')
  })

  it('has correct aria-expanded attribute', () => {
    const tasks = [makeTask('t1', 'done')]
    render(<TaskGroupBlock tasks={tasks} />)
    const button = screen.getByLabelText(/sub-agent/)
    expect(button).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows checkmark when all tasks are done', () => {
    const tasks = [makeTask('t1', 'done')]
    render(<TaskGroupBlock tasks={tasks} />)
    expect(screen.getByText('\u2713')).toBeInTheDocument()
  })

  it('renders singular "sub-agent" for single task', () => {
    const tasks = [makeTask('t1')]
    render(<TaskGroupBlock tasks={tasks} />)
    expect(screen.getByText(/1 sub-agent(?!s)/)).toBeInTheDocument()
  })

  // ─── Agent response display ──────────────────────────────────

  it('shows agent output as markdown when task is done', () => {
    const tasks = [makeTask('t1', 'done', 'Task', { output: 'The agent found **3 files**.' })]
    render(<TaskGroupBlock tasks={tasks} />)
    const md = screen.getByTestId('markdown')
    expect(md).toHaveTextContent('The agent found **3 files**.')
  })

  it('auto-expands output by default', () => {
    const tasks = [makeTask('t1', 'done', 'Task', { output: 'Result here' })]
    render(<TaskGroupBlock tasks={tasks} />)
    expect(screen.getByTestId('markdown')).toBeInTheDocument()
  })

  it('does not show output for running tasks', () => {
    const tasks = [makeTask('t1', 'running', 'Task', { output: 'partial' })]
    render(<TaskGroupBlock tasks={tasks} />)
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })

  it('shows Response toggle button when task has output', () => {
    const tasks = [makeTask('t1', 'done', 'Task', { output: 'Done.' })]
    render(<TaskGroupBlock tasks={tasks} />)
    expect(screen.getByLabelText('Toggle agent response')).toBeInTheDocument()
  })

  it('can collapse and re-expand individual task output', () => {
    const tasks = [makeTask('t1', 'done', 'Task', { output: 'Agent reply' })]
    render(<TaskGroupBlock tasks={tasks} />)

    // Output visible initially
    expect(screen.getByTestId('markdown')).toBeInTheDocument()

    // Collapse output
    fireEvent.click(screen.getByLabelText('Toggle agent response'))
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()

    // Re-expand
    fireEvent.click(screen.getByLabelText('Toggle agent response'))
    expect(screen.getByTestId('markdown')).toBeInTheDocument()
  })

  it('shows description from task input', () => {
    const tasks = [makeTask('t1', 'done', 'Task', {
      input: { description: 'Write auth tests', prompt: '...' },
    })]
    render(<TaskGroupBlock tasks={tasks} />)
    expect(screen.getByText('Write auth tests')).toBeInTheDocument()
  })

  it('shows summary when output is collapsed', () => {
    const tasks = [makeTask('t1', 'done', 'Task', {
      output: 'Full output',
      summary: 'Found 3 files',
    })]
    render(<TaskGroupBlock tasks={tasks} />)

    // Summary hidden when output expanded
    expect(screen.queryByText('Found 3 files')).not.toBeInTheDocument()

    // Collapse output → summary appears
    fireEvent.click(screen.getByLabelText('Toggle agent response'))
    expect(screen.getByText('Found 3 files')).toBeInTheDocument()
  })
})
