// ── Hoisted mocks ─────────────────────────────
const { mockSetEditorContent, mockSaveFile } = vi.hoisted(() => ({
  mockSetEditorContent: vi.fn(),
  mockSaveFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./MarkdownArtifact', () => ({
  MarkdownArtifact: ({ content }: { content: string }) => (
    <div data-testid="mock-markdown">{content}</div>
  ),
}))

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="mock-monaco"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

vi.mock('../../stores/fileExplorerStore', () => {
  const store = () => ({
    setEditorContent: mockSetEditorContent,
    saveFile: mockSaveFile,
  })
  return {
    useFileExplorerStore: Object.assign(store, { getState: store }),
  }
})

// ── Imports ───────────────────────────────────
import { render, screen, fireEvent, act } from '@testing-library/react'
import { NotebookPreview, serializeNotebook } from './NotebookPreview'
import type { EditableCell } from './NotebookPreview'

// ── Helpers ───────────────────────────────────

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

// ── Tests ─────────────────────────────────────

describe('NotebookPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    window.agent = { jupyter: mockJupyter } as any
  })

  // ── Read-only rendering (no filePath) ──────────

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

  // ── Serialization ─────────────────────────────

  describe('serialization', () => {
    it('serializeNotebook produces valid nbformat 4 JSON', () => {
      const cells: EditableCell[] = [
        { _id: 1, cell_type: 'code', source: 'x = 1\ny = 2', outputs: [], execution_count: 1 },
        { _id: 2, cell_type: 'markdown', source: '# Hello' },
      ]
      const meta = { metadata: { kernelspec: { name: 'python3' } }, nbformat: 4, nbformat_minor: 5 }
      const json = serializeNotebook(cells, meta, new Map(), new Map())
      const parsed = JSON.parse(json)

      expect(parsed.nbformat).toBe(4)
      expect(parsed.nbformat_minor).toBe(5)
      expect(parsed.cells).toHaveLength(2)
      expect(parsed.metadata.kernelspec.name).toBe('python3')
    })

    it('splits source into lines with trailing newlines (nbformat convention)', () => {
      const cells: EditableCell[] = [
        { _id: 1, cell_type: 'code', source: 'line1\nline2\nline3', outputs: [], execution_count: null },
      ]
      const json = serializeNotebook(cells, {}, new Map(), new Map())
      const parsed = JSON.parse(json)

      expect(parsed.cells[0].source).toEqual(['line1\n', 'line2\n', 'line3'])
    })

    it('handles empty source', () => {
      const cells: EditableCell[] = [
        { _id: 1, cell_type: 'code', source: '', outputs: [], execution_count: null },
      ]
      const json = serializeNotebook(cells, {}, new Map(), new Map())
      const parsed = JSON.parse(json)
      expect(parsed.cells[0].source).toEqual([''])
    })

    it('includes live outputs and exec counts when available', () => {
      const cells: EditableCell[] = [
        { _id: 1, cell_type: 'code', source: 'x', outputs: [{ output_type: 'stream', text: 'old' }], execution_count: 1 },
      ]
      const liveOutputs = new Map([[1, [{ output_type: 'stream' as const, text: 'new' }]]])
      const liveExecCounts = new Map([[1, 42]])
      const json = serializeNotebook(cells, {}, liveOutputs, liveExecCounts)
      const parsed = JSON.parse(json)

      expect(parsed.cells[0].outputs[0].text).toBe('new')
      expect(parsed.cells[0].execution_count).toBe(42)
    })

    it('roundtrip: parse → make editable → serialize → parse produces valid notebook', () => {
      const original = makeNotebook([
        codeCell('print(1)', [{ output_type: 'stream', name: 'stdout', text: 'hello' }], 3),
        mdCell('# Title'),
        rawCell('raw'),
      ], { kernelspec: { language: 'python', name: 'python3' } })

      const parsed = JSON.parse(original)
      const editableCells: EditableCell[] = parsed.cells.map((c: any, i: number) => ({
        _id: i + 1,
        cell_type: c.cell_type,
        source: Array.isArray(c.source) ? c.source.join('') : c.source,
        outputs: c.outputs,
        execution_count: c.execution_count,
        metadata: c.metadata,
      }))

      const serialized = serializeNotebook(
        editableCells,
        { metadata: parsed.metadata, nbformat: parsed.nbformat },
        new Map(),
        new Map(),
      )
      const reparsed = JSON.parse(serialized)

      expect(reparsed.cells).toHaveLength(3)
      expect(reparsed.cells[0].cell_type).toBe('code')
      expect(reparsed.cells[0].source.join('')).toBe('print(1)')
      expect(reparsed.cells[0].outputs[0].text).toBe('hello')
      expect(reparsed.cells[0].execution_count).toBe(3)
      expect(reparsed.cells[1].cell_type).toBe('markdown')
      expect(reparsed.cells[1].source.join('')).toBe('# Title')
      expect(reparsed.cells[2].cell_type).toBe('raw')
    })

    it('markdown cells do not get outputs or execution_count', () => {
      const cells: EditableCell[] = [
        { _id: 1, cell_type: 'markdown', source: '# Hi' },
      ]
      const json = serializeNotebook(cells, {}, new Map(), new Map())
      const parsed = JSON.parse(json)
      expect(parsed.cells[0].outputs).toBeUndefined()
      expect(parsed.cells[0].execution_count).toBeUndefined()
    })
  })

  // ── Cell editing ──────────────────────────────

  describe('cell editing', () => {
    it('clicking a code cell opens Monaco editor (with filePath)', () => {
      const nb = makeNotebook([codeCell('x = 1')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Pre should be visible initially
      const pre = screen.getByText('x = 1')
      expect(pre.tagName).toBe('PRE')

      // Click to start editing
      fireEvent.click(pre)

      // Monaco mock should appear
      expect(screen.getByTestId('mock-monaco')).toBeInTheDocument()
      expect(screen.getByTestId('mock-monaco')).toHaveValue('x = 1')
    })

    it('code cell click does nothing in read-only mode (no filePath)', () => {
      const nb = makeNotebook([codeCell('x = 1')])
      render(<NotebookPreview content={nb} />)

      const pre = screen.getByText('x = 1')
      fireEvent.click(pre)

      // Monaco should NOT appear
      expect(screen.queryByTestId('mock-monaco')).not.toBeInTheDocument()
    })

    it('editing code cell source updates the cell', () => {
      const nb = makeNotebook([codeCell('original'), codeCell('other')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Click first cell to edit
      fireEvent.click(screen.getByText('original'))

      // Change source in mock Monaco
      const editor = screen.getByTestId('mock-monaco')
      fireEvent.change(editor, { target: { value: 'modified' } })

      // Click second cell to commit first and start editing second
      fireEvent.click(screen.getByText('other'))

      // First cell should now show 'modified' in its pre
      expect(screen.getByText('modified')).toBeInTheDocument()
      expect(screen.getByText('modified').tagName).toBe('PRE')
    })

    it('double-clicking a markdown cell opens textarea editor (with filePath)', () => {
      const nb = makeNotebook([mdCell('# Hello')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      const mdDiv = screen.getByTestId('mock-markdown')
      fireEvent.doubleClick(mdDiv.parentElement!)

      // Textarea should appear
      const textarea = screen.getByRole('textbox')
      expect(textarea.tagName).toBe('TEXTAREA')
      expect(textarea).toHaveValue('# Hello')
    })

    it('markdown double-click does nothing in read-only mode', () => {
      const nb = makeNotebook([mdCell('# Hello')])
      render(<NotebookPreview content={nb} />)

      const mdDiv = screen.getByTestId('mock-markdown')
      fireEvent.doubleClick(mdDiv.parentElement!)

      // No textarea should appear
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('editing markdown cell source and blurring commits the change', () => {
      const nb = makeNotebook([mdCell('# Original')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Double-click to edit
      const mdDiv = screen.getByTestId('mock-markdown')
      fireEvent.doubleClick(mdDiv.parentElement!)

      // Change source
      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '# Modified' } })

      // Blur to commit
      fireEvent.blur(textarea)

      // Markdown should now render the new content
      expect(screen.getByTestId('mock-markdown')).toHaveTextContent('# Modified')
    })

    it('double-clicking a raw cell opens textarea editor (with filePath)', () => {
      const nb = makeNotebook([rawCell('raw text')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      const rawDiv = screen.getByText('raw text')
      fireEvent.doubleClick(rawDiv.parentElement!)

      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('raw text')
    })

    it('Escape key in markdown textarea commits the edit', () => {
      const nb = makeNotebook([mdCell('# Test')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Double-click to edit
      fireEvent.doubleClick(screen.getByTestId('mock-markdown').parentElement!)

      const textarea = screen.getByRole('textbox')
      fireEvent.change(textarea, { target: { value: '# Updated' } })

      // Press Escape
      fireEvent.keyDown(textarea, { key: 'Escape' })

      // Back to rendered markdown
      expect(screen.getByTestId('mock-markdown')).toHaveTextContent('# Updated')
    })
  })

  // ── Cell operations ───────────────────────────

  describe('cell operations', () => {
    it('shows AddCellBar when filePath is provided', () => {
      const nb = makeNotebook([codeCell('x')])
      const { container } = render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // AddCellBar contains "+ Code" and "+ Markdown" buttons
      expect(screen.getAllByText('+ Code').length).toBeGreaterThan(0)
      expect(screen.getAllByText('+ Markdown').length).toBeGreaterThan(0)
    })

    it('does not show AddCellBar in read-only mode', () => {
      const nb = makeNotebook([codeCell('x')])
      render(<NotebookPreview content={nb} />)

      expect(screen.queryByText('+ Code')).not.toBeInTheDocument()
      expect(screen.queryByText('+ Markdown')).not.toBeInTheDocument()
    })

    it('clicking "+ Code" adds a new code cell', () => {
      const nb = makeNotebook([codeCell('first')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      expect(screen.getByText('1 cell')).toBeInTheDocument()

      // Click "+ Code" (there's one after the first cell)
      const addBtns = screen.getAllByText('+ Code')
      fireEvent.click(addBtns[0])

      // Cell count should increase
      expect(screen.getByText('2 cells')).toBeInTheDocument()

      // New cell should auto-open in edit mode (Monaco mock appears)
      expect(screen.getByTestId('mock-monaco')).toBeInTheDocument()
    })

    it('clicking "+ Markdown" adds a new markdown cell', () => {
      const nb = makeNotebook([codeCell('first')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      const addBtns = screen.getAllByText('+ Markdown')
      fireEvent.click(addBtns[0])

      expect(screen.getByText('2 cells')).toBeInTheDocument()

      // New markdown cell should auto-open in edit mode (textarea)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('delete cell removes it from the list', () => {
      const nb = makeNotebook([
        codeCell('cell_one'),
        codeCell('cell_two'),
      ])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      expect(screen.getByText('2 cells')).toBeInTheDocument()

      // Find and click the first delete button (✕)
      const deleteButtons = screen.getAllByTitle('Delete cell')
      fireEvent.click(deleteButtons[0])

      expect(screen.getByText('1 cell')).toBeInTheDocument()
      expect(screen.queryByText('cell_one')).not.toBeInTheDocument()
      expect(screen.getByText('cell_two')).toBeInTheDocument()
    })

    it('move cell down swaps cells', () => {
      const nb = makeNotebook([
        codeCell('FIRST'),
        codeCell('SECOND'),
      ])
      const { container } = render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Get all pre elements with code content (the source pre's have class flex-1)
      const getPres = () => Array.from(container.querySelectorAll('pre.flex-1')).map(p => p.textContent)

      expect(getPres()).toEqual(['FIRST', 'SECOND'])

      // Click "Move down" on first cell
      const moveDownBtns = screen.getAllByTitle('Move down')
      fireEvent.click(moveDownBtns[0])

      expect(getPres()).toEqual(['SECOND', 'FIRST'])
    })

    it('move cell up swaps cells', () => {
      const nb = makeNotebook([
        codeCell('FIRST'),
        codeCell('SECOND'),
      ])
      const { container } = render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      const getPres = () => Array.from(container.querySelectorAll('pre.flex-1')).map(p => p.textContent)

      // Click "Move up" on second cell
      const moveUpBtns = screen.getAllByTitle('Move up')
      fireEvent.click(moveUpBtns[1])

      expect(getPres()).toEqual(['SECOND', 'FIRST'])
    })

    it('does not show CellToolbar in read-only mode', () => {
      const nb = makeNotebook([codeCell('x')])
      render(<NotebookPreview content={nb} />)

      expect(screen.queryByTitle('Delete cell')).not.toBeInTheDocument()
      expect(screen.queryByTitle('Move up')).not.toBeInTheDocument()
      expect(screen.queryByTitle('Move down')).not.toBeInTheDocument()
    })

    it('outputs follow their cell when moved', async () => {
      let outputCallback: (chunk: any) => void = () => {}
      mockJupyter.onOutput.mockImplementation((cb: any) => {
        outputCallback = cb
        return () => {}
      })
      mockJupyter.executeCell.mockResolvedValue('req_1')

      const nb = makeNotebook([
        codeCell('cellA'),
        codeCell('cellB'),
      ])
      const { container } = render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Start kernel
      act(() => {
        outputCallback({ filePath: '/tmp/test.ipynb', id: null, type: 'ready' })
      })

      // Run first cell
      await vi.waitFor(() => {
        expect(screen.getAllByTitle('Run cell')[0]).toBeEnabled()
      })
      fireEvent.click(screen.getAllByTitle('Run cell')[0])

      await vi.waitFor(() => {
        expect(mockJupyter.executeCell).toHaveBeenCalledWith('/tmp/test.ipynb', 'cellA')
      })

      // Simulate output for first cell
      act(() => {
        outputCallback({
          filePath: '/tmp/test.ipynb',
          id: 'req_1',
          type: 'stream',
          name: 'stdout',
          text: 'output_from_A',
        })
      })

      await vi.waitFor(() => {
        expect(screen.getByText('output_from_A')).toBeInTheDocument()
      })

      // Move first cell down
      const moveDownBtns = screen.getAllByTitle('Move down')
      fireEvent.click(moveDownBtns[0])

      // The output should still be present (associated with the cell by _id)
      expect(screen.getByText('output_from_A')).toBeInTheDocument()

      // Verify order: cellB is now first, cellA (with output) is second
      const pres = Array.from(container.querySelectorAll('pre.flex-1')).map(p => p.textContent)
      expect(pres).toEqual(['cellB', 'cellA'])
    })
  })

  // ── Dirty tracking ────────────────────────────

  describe('dirty tracking', () => {
    it('does not call setEditorContent on initial render', async () => {
      const nb = makeNotebook([codeCell('x = 1')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Wait a bit to ensure debounce timer would have fired
      await act(async () => {
        await new Promise(r => setTimeout(r, 400))
      })

      expect(mockSetEditorContent).not.toHaveBeenCalled()
    })

    it('calls setEditorContent after editing a cell (debounced)', async () => {
      const nb = makeNotebook([codeCell('original')])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Click to edit
      fireEvent.click(screen.getByText('original'))

      // Change source
      const editor = screen.getByTestId('mock-monaco')
      fireEvent.change(editor, { target: { value: 'edited' } })

      // Wait for debounce (300ms) + some margin
      await vi.waitFor(() => {
        expect(mockSetEditorContent).toHaveBeenCalled()
      }, { timeout: 1000 })

      // Verify the serialized content includes the edited source
      const serialized = mockSetEditorContent.mock.calls[0][0]
      const parsed = JSON.parse(serialized)
      expect(parsed.cells[0].source.join('')).toBe('edited')
    })

    it('kernel executes the edited source, not the original', async () => {
      let outputCallback: (chunk: any) => void = () => {}
      mockJupyter.onOutput.mockImplementation((cb: any) => {
        outputCallback = cb
        return () => {}
      })

      const nb = makeNotebook([codeCell('print("old")', [], null)])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Start kernel
      act(() => {
        outputCallback({ filePath: '/tmp/test.ipynb', id: null, type: 'ready' })
      })

      // Wait for kernel to be idle ([ ] becomes a clickable button)
      await vi.waitFor(() => {
        expect(screen.getByText('[ ]').tagName).toBe('BUTTON')
      })

      // Click code pre to edit
      fireEvent.click(screen.getByText('print("old")'))

      // Change source in mock Monaco
      const editor = screen.getByTestId('mock-monaco')
      fireEvent.change(editor, { target: { value: 'print("new")' } })

      // Click run button (still visible next to the editor)
      const runBtn = screen.getByTitle('Run cell')
      fireEvent.click(runBtn)

      await vi.waitFor(() => {
        expect(mockJupyter.executeCell).toHaveBeenCalledWith('/tmp/test.ipynb', 'print("new")')
      })
    })

    it('does not re-init cells when content matches own serialization (no infinite loop)', async () => {
      const nb = makeNotebook([codeCell('x = 1')])
      const { rerender } = render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      // Edit to trigger serialization
      fireEvent.click(screen.getByText('x = 1'))
      const editor = screen.getByTestId('mock-monaco')
      fireEvent.change(editor, { target: { value: 'x = 2' } })

      // Wait for setEditorContent to be called
      await vi.waitFor(() => {
        expect(mockSetEditorContent).toHaveBeenCalled()
      }, { timeout: 1000 })

      const serialized = mockSetEditorContent.mock.calls[0][0]

      // Simulate the save flow: content prop changes to our serialized version
      mockSetEditorContent.mockClear()
      rerender(<NotebookPreview content={serialized} filePath="/tmp/test.ipynb" />)

      // Wait to ensure no new serialization cycle
      await act(async () => {
        await new Promise(r => setTimeout(r, 400))
      })

      // setEditorContent should NOT be called again (loop guard)
      expect(mockSetEditorContent).not.toHaveBeenCalled()
    })
  })

  // ── Empty notebook with filePath ──────────────

  describe('empty notebook editing', () => {
    it('shows AddCellBar for empty notebook with filePath', () => {
      const nb = makeNotebook([])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      expect(screen.getByText('+ Code')).toBeInTheDocument()
      expect(screen.getByText('+ Markdown')).toBeInTheDocument()
    })

    it('can add a cell to an empty notebook', () => {
      const nb = makeNotebook([])
      render(<NotebookPreview content={nb} filePath="/tmp/test.ipynb" />)

      fireEvent.click(screen.getByText('+ Code'))

      expect(screen.getByText('1 cell')).toBeInTheDocument()
      expect(screen.getByTestId('mock-monaco')).toBeInTheDocument()
    })
  })
})
