vi.mock('./MarkdownArtifact', () => ({
  MarkdownArtifact: ({ content }: { content: string }) => (
    <div data-testid="mock-markdown">{content}</div>
  ),
}))

import { render, screen, fireEvent, act } from '@testing-library/react'
import { NotebookPreview } from './NotebookPreview'

function makeNotebook(cells: object[], metadata?: object): string {
  return JSON.stringify({ cells, metadata, nbformat: 4 })
}

function codeCell(source: string | string[], outputs: object[] = [], execution_count: number | null = 1): object {
  return { cell_type: 'code', source, outputs, execution_count }
}

function mdCell(source: string | string[]): object {
  return { cell_type: 'markdown', source }
}

function rawCell(source: string | string[]): object {
  return { cell_type: 'raw', source }
}

describe('NotebookPreview', () => {
  it('renders code, markdown, and raw cells', () => {
    const nb = makeNotebook([
      codeCell('print("hi")'),
      mdCell('# Title'),
      rawCell('raw text'),
    ])
    render(<NotebookPreview content={nb} />)

    expect(screen.getByText('print("hi")')).toBeInTheDocument()
    expect(screen.getByTestId('mock-markdown')).toHaveTextContent('# Title')
    expect(screen.getByText('raw text')).toBeInTheDocument()
  })

  it('shows execution count for code cells', () => {
    const nb = makeNotebook([codeCell('x = 1', [], 42)])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText('[42]')).toBeInTheDocument()
  })

  it('shows [ ] for null execution count', () => {
    const nb = makeNotebook([codeCell('x = 1', [], null)])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText('[ ]')).toBeInTheDocument()
  })

  it('shows error for invalid JSON', () => {
    render(<NotebookPreview content="not json{{{" />)
    expect(screen.getByText(/Failed to parse notebook/)).toBeInTheDocument()
  })

  it('shows error for JSON missing cells array', () => {
    render(<NotebookPreview content='{"metadata":{}}' />)
    expect(screen.getByText(/Failed to parse notebook/)).toBeInTheDocument()
  })

  it('renders empty notebook', () => {
    const nb = makeNotebook([])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText('0 cells')).toBeInTheDocument()
  })

  it('shows singular "cell" for 1 cell', () => {
    const nb = makeNotebook([codeCell('x')])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText('1 cell')).toBeInTheDocument()
  })

  it('renders text/plain outputs', () => {
    const nb = makeNotebook([
      codeCell('1+1', [
        { output_type: 'execute_result', data: { 'text/plain': '2' } },
      ]),
    ])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders stream outputs', () => {
    const nb = makeNotebook([
      codeCell('print("hi")', [
        { output_type: 'stream', name: 'stdout', text: 'stream output here\n' },
      ]),
    ])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText(/stream output here/)).toBeInTheDocument()
  })

  it('renders stderr with error color', () => {
    const nb = makeNotebook([
      codeCell('import warnings', [
        { output_type: 'stream', name: 'stderr', text: 'warning!' },
      ]),
    ])
    const { container } = render(<NotebookPreview content={nb} />)
    const stderrDiv = container.querySelector('[style*="--color-error"]')
    expect(stderrDiv).toBeInTheDocument()
    expect(stderrDiv!.textContent).toContain('warning!')
  })

  it('renders base64 image outputs', () => {
    const nb = makeNotebook([
      codeCell('plot()', [
        { output_type: 'display_data', data: { 'image/png': 'iVBOR' } },
      ]),
    ])
    render(<NotebookPreview content={nb} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,iVBOR')
  })

  it('sanitizes text/html outputs', () => {
    const nb = makeNotebook([
      codeCell('html', [
        { output_type: 'display_data', data: { 'text/html': '<b>safe</b><script>alert(1)</script>' } },
      ]),
    ])
    const { container } = render(<NotebookPreview content={nb} />)
    expect(container.querySelector('b')).toHaveTextContent('safe')
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders error outputs with traceback', () => {
    const nb = makeNotebook([
      codeCell('1/0', [
        {
          output_type: 'error',
          ename: 'ZeroDivisionError',
          evalue: 'division by zero',
          traceback: ['Traceback:', 'line 1', 'ZeroDivisionError: division by zero'],
        },
      ]),
    ])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText(/ZeroDivisionError/)).toBeInTheDocument()
  })

  it('strips ANSI codes from error tracebacks', () => {
    const nb = makeNotebook([
      codeCell('err', [
        {
          output_type: 'error',
          ename: 'Error',
          evalue: 'fail',
          traceback: ['\x1b[0;31mError\x1b[0m: fail'],
        },
      ]),
    ])
    render(<NotebookPreview content={nb} />)
    const errorText = screen.getByText(/Error: fail/)
    expect(errorText.textContent).not.toContain('\x1b')
  })

  it('handles source as string (nbformat 3 compat)', () => {
    const nb = makeNotebook([codeCell('single string source')])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText('single string source')).toBeInTheDocument()
  })

  it('handles source as array (nbformat 4)', () => {
    const nb = makeNotebook([codeCell(['alpha\n', 'beta'])])
    const { container } = render(<NotebookPreview content={nb} />)
    const pre = container.querySelector('pre.flex-1')
    expect(pre).toBeInTheDocument()
    expect(pre!.textContent).toBe('alpha\nbeta')
  })

  it('displays kernel language from metadata', () => {
    const nb = makeNotebook(
      [codeCell('x')],
      { kernelspec: { language: 'julia' } },
    )
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText('julia')).toBeInTheDocument()
  })

  it('defaults to python when no kernelspec', () => {
    const nb = makeNotebook([codeCell('x')])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText('python')).toBeInTheDocument()
  })

  it('collapses long outputs and expands on click', () => {
    const longText = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
    const nb = makeNotebook([
      codeCell('x', [
        { output_type: 'stream', name: 'stdout', text: longText },
      ]),
    ])
    render(<NotebookPreview content={nb} />)

    // Should show collapse button
    const btn = screen.getByText(/Show 10 more lines/)
    expect(btn).toBeInTheDocument()

    // Click to expand
    fireEvent.click(btn)
    expect(screen.getByText('Show less')).toBeInTheDocument()

    // Click to collapse again
    fireEvent.click(screen.getByText('Show less'))
    expect(screen.getByText(/Show 10 more lines/)).toBeInTheDocument()
  })

  it('renders error fallback when traceback is empty', () => {
    const nb = makeNotebook([
      codeCell('err', [
        { output_type: 'error', ename: 'TypeError', evalue: 'bad type', traceback: [] },
      ]),
    ])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText('TypeError: bad type')).toBeInTheDocument()
  })

  it('renders stream output from string array', () => {
    const nb = makeNotebook([
      codeCell('print', [
        { output_type: 'stream', name: 'stdout', text: ['line1\n', 'line2\n'] },
      ]),
    ])
    render(<NotebookPreview content={nb} />)
    expect(screen.getByText(/line1/)).toBeInTheDocument()
  })

  // ── Kernel integration tests ────────────────────

  describe('kernel integration', () => {
    const mockJupyter = {
      startKernel: vi.fn().mockResolvedValue({ status: 'starting' }),
      executeCell: vi.fn().mockResolvedValue('req_1'),
      interruptKernel: vi.fn().mockResolvedValue(undefined),
      restartKernel: vi.fn().mockResolvedValue(undefined),
      shutdownKernel: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue(null),
      detectJupyter: vi.fn().mockResolvedValue({ found: true, pythonPath: '/usr/bin/python3' }),
      onOutput: vi.fn().mockReturnValue(() => {}),
    }

    beforeEach(() => {
      vi.clearAllMocks()
      window.agent = { jupyter: mockJupyter } as any
    })

    it('does not show kernel toolbar when filePath is not provided', () => {
      const nb = makeNotebook([codeCell('x = 1')])
      render(<NotebookPreview content={nb} />)
      expect(screen.queryByText('Start Kernel')).not.toBeInTheDocument()
    })

    it('shows kernel toolbar when filePath is provided', () => {
      const nb = makeNotebook([codeCell('x = 1')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)
      expect(screen.getByText('Start Kernel')).toBeInTheDocument()
    })

    it('shows "Start Kernel" button when kernel is off', () => {
      const nb = makeNotebook([codeCell('x = 1')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)
      const btn = screen.getByText('Start Kernel')
      expect(btn).toBeInTheDocument()
      expect(btn.tagName).toBe('BUTTON')
    })

    it('calls detectJupyter and startKernel on Start Kernel click', async () => {
      const nb = makeNotebook([codeCell('x = 1')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      fireEvent.click(screen.getByText('Start Kernel'))

      await vi.waitFor(() => {
        expect(mockJupyter.detectJupyter).toHaveBeenCalledTimes(1)
      })
      expect(mockJupyter.startKernel).toHaveBeenCalledWith('/tmp/test.ipynb', undefined)
    })

    it('shows error banner when jupyter not found', async () => {
      mockJupyter.detectJupyter.mockResolvedValueOnce({ found: false, pythonPath: null })

      const nb = makeNotebook([codeCell('x = 1')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      fireEvent.click(screen.getByText('Start Kernel'))

      await vi.waitFor(() => {
        expect(screen.getByText(/Jupyter not found/)).toBeInTheDocument()
      })
    })

    it('code cells show clickable execution count when kernel is active', async () => {
      let outputCallback: (chunk: any) => void = () => {}
      mockJupyter.onOutput.mockImplementation((cb: any) => {
        outputCallback = cb
        return () => {}
      })

      const nb = makeNotebook([codeCell('x = 1', [], 1)])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Before kernel starts, [1] should be a span (not clickable)
      expect(screen.getByText('[1]').tagName).toBe('SPAN')

      // Simulate kernel becoming idle via the onOutput callback
      act(() => {
        outputCallback({ filePath: '/tmp/test.ipynb', id: null, type: 'ready' })
      })

      await vi.waitFor(() => {
        // Now [1] should be a button (clickable)
        expect(screen.getByText('[1]').tagName).toBe('BUTTON')
      })
    })

    it('renders live outputs from kernel execution', async () => {
      let outputCallback: (chunk: any) => void = () => {}
      mockJupyter.onOutput.mockImplementation((cb: any) => {
        outputCallback = cb
        return () => {}
      })
      mockJupyter.executeCell.mockResolvedValue('req_42')

      const nb = makeNotebook([codeCell('print("hello")', [], null)])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Start kernel — simulate ready
      act(() => {
        outputCallback({ filePath: '/tmp/test.ipynb', id: null, type: 'ready' })
      })

      await vi.waitFor(() => {
        expect(screen.getByText('[ ]').tagName).toBe('BUTTON')
      })

      // Click the run button on the code cell
      fireEvent.click(screen.getByText('[ ]'))

      await vi.waitFor(() => {
        expect(mockJupyter.executeCell).toHaveBeenCalledWith('/tmp/test.ipynb', 'print("hello")')
      })

      // Simulate stream output arriving for request req_42
      act(() => {
        outputCallback({
          filePath: '/tmp/test.ipynb',
          id: 'req_42',
          type: 'stream',
          name: 'stdout',
          text: 'hello world from kernel',
        })
      })

      await vi.waitFor(() => {
        expect(screen.getByText('hello world from kernel')).toBeInTheDocument()
      })
    })
  })
})
