import { render, screen, fireEvent } from '@testing-library/react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useFileExplorerStore } from '../../stores/fileExplorerStore'
import { useUiStore } from '../../stores/uiStore'

beforeAll(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    render(<MarkdownRenderer content="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders inline code without [object Object]', () => {
    render(<MarkdownRenderer content="Use `myFunc()` here" />)
    expect(screen.getByText('myFunc()')).toBeInTheDocument()
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument()
  })

  it('renders fenced code blocks without [object Object]', () => {
    const md = '```js\nconst x = 1\n```'
    render(<MarkdownRenderer content={md} />)
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument()
  })

  it('renders html code blocks as text, not [object Object]', () => {
    const md = '```html\n<div>Hello</div>\n```'
    render(<MarkdownRenderer content={md} />)
    expect(screen.getByText('<div>Hello</div>')).toBeInTheDocument()
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument()
  })

  it('renders code blocks without language as block (not inline)', () => {
    const md = '```\n┌──────┐\n│ test │\n└──────┘\n```'
    const { container } = render(<MarkdownRenderer content={md} />)
    // Should render in a CodeBlock (pre element), not as inline code
    const pre = container.querySelector('pre')
    expect(pre).toBeInTheDocument()
    expect(pre!.textContent).toContain('┌──────┐')
    expect(pre!.textContent).toContain('│ test │')
  })

  it('shows language label on code blocks', () => {
    const md = '```python\nprint("hi")\n```'
    render(<MarkdownRenderer content={md} />)
    expect(screen.getByText('python')).toBeInTheDocument()
  })

  it('renders headings', () => {
    render(<MarkdownRenderer content="## My Heading" />)
    expect(screen.getByText('My Heading')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
  })

  it('renders lists', () => {
    render(<MarkdownRenderer content={'- item A\n- item B'} />)
    expect(screen.getByText('item A')).toBeInTheDocument()
    expect(screen.getByText('item B')).toBeInTheDocument()
  })

  describe('link click handling', () => {
    it('opens local file paths in file explorer panel', () => {
      const selectFileSpy = vi.spyOn(useFileExplorerStore.getState(), 'selectFile').mockResolvedValue()
      // Ensure panel starts closed
      useUiStore.setState({ panelVisible: false })

      render(<MarkdownRenderer content="See [report.txt](/tmp/cwd/attachments/report.txt)" />)
      const link = screen.getByText('report.txt')
      fireEvent.click(link)

      expect(selectFileSpy).toHaveBeenCalledWith('/tmp/cwd/attachments/report.txt')
      expect(useUiStore.getState().panelVisible).toBe(true)

      selectFileSpy.mockRestore()
    })

    it('does not toggle panel if already open', () => {
      const selectFileSpy = vi.spyOn(useFileExplorerStore.getState(), 'selectFile').mockResolvedValue()
      useUiStore.setState({ panelVisible: true })

      render(<MarkdownRenderer content="[data.csv](/home/user/data.csv)" />)
      fireEvent.click(screen.getByText('data.csv'))

      expect(selectFileSpy).toHaveBeenCalledWith('/home/user/data.csv')
      expect(useUiStore.getState().panelVisible).toBe(true)

      selectFileSpy.mockRestore()
    })

    it('opens external URLs via openExternal', () => {
      render(<MarkdownRenderer content="Visit [example](https://example.com)" />)
      fireEvent.click(screen.getByText('example'))

      expect(window.agent.system.openExternal).toHaveBeenCalledWith('https://example.com')
    })

    it('shows file viewer tooltip for local paths', () => {
      render(<MarkdownRenderer content="[photo.png](/tmp/photo.png)" />)
      const link = screen.getByText('photo.png')
      expect(link).toHaveAttribute('title', 'Open in file viewer')
    })

    it('shows URL as tooltip for external links', () => {
      render(<MarkdownRenderer content="[docs](https://docs.example.com)" />)
      const link = screen.getByText('docs')
      expect(link).toHaveAttribute('title', 'https://docs.example.com')
    })
  })
})
