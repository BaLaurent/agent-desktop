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

  describe('contextual info', () => {
    it('shows Bash description next to tool name', () => {
      const tool: ToolPart = {
        type: 'tool', name: 'Bash', id: 'tool_10', status: 'done',
        input: { command: 'npm test', description: 'Run unit tests' },
        output: 'pass',
      }
      render(<ToolUseBlock tool={tool} />)
      expect(screen.getByText(/· Run unit tests/)).toBeInTheDocument()
    })

    it('shows truncated file path for Read tool', () => {
      const tool: ToolPart = {
        type: 'tool', name: 'Read', id: 'tool_11', status: 'done',
        input: { file_path: '/home/user/Projects/myapp/src/components/Button.tsx' },
        output: 'file content',
      }
      render(<ToolUseBlock tool={tool} />)
      // 3 last dirs + filename = myapp/src/components/Button.tsx
      expect(screen.getByText(/· myapp\/src\/components\/Button\.tsx/)).toBeInTheDocument()
    })

    it('shows truncated file path for Edit tool', () => {
      const tool: ToolPart = {
        type: 'tool', name: 'Edit', id: 'tool_12', status: 'done',
        input: { file_path: '/home/user/deep/nested/folder/file.ts', old_str: 'a', new_str: 'b' },
        output: 'ok',
      }
      render(<ToolUseBlock tool={tool} />)
      expect(screen.getByText(/· deep\/nested\/folder\/file\.ts/)).toBeInTheDocument()
    })

    it('keeps short paths intact without truncation', () => {
      const tool: ToolPart = {
        type: 'tool', name: 'Read', id: 'tool_13', status: 'done',
        input: { file_path: 'src/index.ts' },
        output: 'content',
      }
      render(<ToolUseBlock tool={tool} />)
      expect(screen.getByText(/· src\/index\.ts/)).toBeInTheDocument()
    })

    it('does not show context for unknown tools', () => {
      const tool: ToolPart = {
        type: 'tool', name: 'Glob', id: 'tool_14', status: 'done',
        input: { pattern: '**/*.ts' },
        output: 'files',
      }
      render(<ToolUseBlock tool={tool} />)
      expect(screen.queryByText(/·/)).not.toBeInTheDocument()
    })

    it('shows context in full view for running Read tool', () => {
      const tool: ToolPart = {
        type: 'tool', name: 'Read', id: 'tool_15', status: 'running',
        input: { file_path: '/home/user/app/src/utils/helpers.ts' },
      }
      render(<ToolUseBlock tool={tool} />)
      expect(screen.getByText(/· app\/src\/utils\/helpers\.ts/)).toBeInTheDocument()
    })

    it('hides summary when context is available', () => {
      const tool: ToolPart = {
        type: 'tool', name: 'Bash', id: 'tool_16', status: 'done',
        input: { command: 'npm test', description: 'Run tests' },
        summary: 'Some summary',
      }
      render(<ToolUseBlock tool={tool} />)
      expect(screen.getByText(/· Run tests/)).toBeInTheDocument()
      expect(screen.queryByText('Some summary')).not.toBeInTheDocument()
    })

    it('shows truncated path as tooltip on hover', () => {
      const tool: ToolPart = {
        type: 'tool', name: 'Read', id: 'tool_17', status: 'done',
        input: { file_path: '/home/user/Projects/myapp/src/components/Button.tsx' },
        output: 'content',
      }
      render(<ToolUseBlock tool={tool} />)
      const contextSpan = screen.getByText(/· myapp\/src\/components\/Button\.tsx/)
      expect(contextSpan).toHaveAttribute('title', 'myapp/src/components/Button.tsx')
    })
  })
})
