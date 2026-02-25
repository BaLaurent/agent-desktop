vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="mock-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

vi.mock('../../stores/fileExplorerStore', () => ({
  useFileExplorerStore: { getState: () => ({ saveFile: vi.fn() }) },
}))

vi.mock('../artifacts/HtmlPreview', () => ({
  HtmlPreview: ({ filePath, allowScripts }: { filePath?: string; allowScripts?: boolean }) => (
    <div data-testid="mock-html-preview" data-filepath={filePath} data-scripts={String(!!allowScripts)} />
  ),
}))

vi.mock('../artifacts/MarkdownArtifact', () => ({
  MarkdownArtifact: ({ content }: { content: string }) => (
    <div data-testid="mock-markdown">{content}</div>
  ),
}))

vi.mock('../artifacts/MermaidBlock', () => ({
  MermaidBlock: ({ content }: { content: string }) => (
    <div data-testid="mock-mermaid">{content}</div>
  ),
}))

vi.mock('../artifacts/SvgPreview', () => ({
  SvgPreview: ({ content }: { content: string }) => (
    <div data-testid="mock-svg">{content}</div>
  ),
}))

vi.mock('../artifacts/NotebookPreview', () => ({
  NotebookPreview: ({ content }: { content: string }) => (
    <div data-testid="mock-notebook">{content}</div>
  ),
}))

vi.mock('../artifacts/ModelPreview', () => ({
  ModelPreview: ({ filePath }: { filePath: string }) => (
    <div data-testid="mock-model">{filePath}</div>
  ),
}))

vi.mock('../artifacts/ScadPreview', () => ({
  ScadPreview: ({ filePath }: { filePath: string }) => (
    <div data-testid="mock-scad">{filePath}</div>
  ),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { ExpandedViewerModal } from './ExpandedViewerModal'

describe('ExpandedViewerModal', () => {
  const baseProps = {
    filePath: '/home/user/index.ts',
    content: 'const x = 1',
    language: 'typescript' as string | null,
    initialMode: 'source' as const,
    canToggle: false,
    onChange: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Shell behavior (shared) ──────────────────────────────────

  it('renders the filename in the header', () => {
    render(<ExpandedViewerModal {...baseProps} />)
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  it('Close button calls onClose', () => {
    render(<ExpandedViewerModal {...baseProps} />)
    fireEvent.click(screen.getByLabelText('Close expanded view'))
    expect(baseProps.onClose).toHaveBeenCalled()
  })

  it('Escape key calls onClose', () => {
    render(<ExpandedViewerModal {...baseProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(baseProps.onClose).toHaveBeenCalled()
  })

  it('non-Escape keys do not trigger close', () => {
    render(<ExpandedViewerModal {...baseProps} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(baseProps.onClose).not.toHaveBeenCalled()
  })

  it('backdrop click calls onClose', () => {
    render(<ExpandedViewerModal {...baseProps} />)
    const backdrop = screen.getByText('index.ts').closest('.fixed')!
    fireEvent.click(backdrop)
    expect(baseProps.onClose).toHaveBeenCalled()
  })

  it('clicking inside the modal does not call onClose', () => {
    render(<ExpandedViewerModal {...baseProps} />)
    fireEvent.click(screen.getByText('index.ts'))
    expect(baseProps.onClose).not.toHaveBeenCalled()
  })

  // ── Source mode ──────────────────────────────────────────────

  it('renders editor when initialMode is source', () => {
    render(<ExpandedViewerModal {...baseProps} />)
    const editor = screen.getByTestId('mock-editor') as HTMLTextAreaElement
    expect(editor.value).toBe('const x = 1')
  })

  it('calls onChange when editor value changes', () => {
    render(<ExpandedViewerModal {...baseProps} />)
    const editor = screen.getByTestId('mock-editor')
    fireEvent.change(editor, { target: { value: 'const x = 2' } })
    expect(baseProps.onChange).toHaveBeenCalledWith('const x = 2')
  })

  // ── Preview mode ─────────────────────────────────────────────

  it('renders markdown viewer for .md files in preview mode', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/home/user/doc.md"
        content="# Hello"
        language="markdown"
        initialMode="preview"
      />
    )
    expect(screen.getByTestId('mock-markdown')).toBeInTheDocument()
  })

  it('renders image viewer when language is image', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/img/photo.png"
        language="image"
        content="data:image/png;base64,abc"
        initialMode="preview"
      />
    )
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc')
    expect(img).toHaveAttribute('alt', 'photo.png')
  })

  it('renders SVG viewer for .svg files in preview mode', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/test/icon.svg"
        content="<svg></svg>"
        initialMode="preview"
      />
    )
    expect(screen.getByTestId('mock-svg')).toBeInTheDocument()
  })

  it('renders HTML viewer for .html files in preview mode', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/test/page.html"
        content="<h1>Hi</h1>"
        allowScripts
        initialMode="preview"
      />
    )
    const el = screen.getByTestId('mock-html-preview')
    expect(el).toHaveAttribute('data-filepath', '/test/page.html')
    expect(el).toHaveAttribute('data-scripts', 'true')
  })

  it('renders HTML viewer for .htm files in preview mode', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/test/page.htm"
        content="<h1>Hi</h1>"
        initialMode="preview"
      />
    )
    expect(screen.getByTestId('mock-html-preview')).toBeInTheDocument()
  })

  it('renders Mermaid viewer for .mmd files in preview mode', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/test/diagram.mmd"
        content="graph TD; A-->B"
        initialMode="preview"
      />
    )
    expect(screen.getByTestId('mock-mermaid')).toBeInTheDocument()
  })

  it('renders notebook viewer for .ipynb files in preview mode', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/test/analysis.ipynb"
        language="ipynb"
        content='{"cells":[]}'
        initialMode="preview"
      />
    )
    expect(screen.getByTestId('mock-notebook')).toBeInTheDocument()
  })

  it('renders .markdown extension as markdown in preview mode', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/readme.markdown"
        content="## Title"
        initialMode="preview"
      />
    )
    expect(screen.getByTestId('mock-markdown')).toBeInTheDocument()
  })

  it('renders fallback for unknown preview types', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/test/data.json"
        language="json"
        content="{}"
        initialMode="preview"
      />
    )
    expect(screen.getByText('No preview available')).toBeInTheDocument()
  })

  // ── Toggle behavior ──────────────────────────────────────────

  it('shows toggle button when canToggle is true', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/home/user/doc.md"
        canToggle={true}
        initialMode="source"
      />
    )
    expect(screen.getByLabelText('Switch to preview')).toBeInTheDocument()
  })

  it('hides toggle button when canToggle is false', () => {
    render(<ExpandedViewerModal {...baseProps} canToggle={false} />)
    expect(screen.queryByLabelText('Switch to preview')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Switch to source view')).not.toBeInTheDocument()
  })

  it('toggles from source to preview on click', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/home/user/doc.md"
        content="# Hello"
        language="markdown"
        canToggle={true}
        initialMode="source"
      />
    )
    // Initially in source mode — editor visible
    expect(screen.getByTestId('mock-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-markdown')).not.toBeInTheDocument()

    // Click toggle
    fireEvent.click(screen.getByLabelText('Switch to preview'))

    // Now in preview mode — markdown visible
    expect(screen.getByTestId('mock-markdown')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-editor')).not.toBeInTheDocument()
  })

  it('toggles from preview to source on click', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/home/user/doc.md"
        content="# Hello"
        language="markdown"
        canToggle={true}
        initialMode="preview"
      />
    )
    // Initially in preview mode
    expect(screen.getByTestId('mock-markdown')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-editor')).not.toBeInTheDocument()

    // Click toggle
    fireEvent.click(screen.getByLabelText('Switch to source view'))

    // Now in source mode
    expect(screen.getByTestId('mock-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-markdown')).not.toBeInTheDocument()
  })

  it('toggle label updates after switching modes', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/home/user/doc.md"
        canToggle={true}
        initialMode="source"
      />
    )
    const btn = screen.getByLabelText('Switch to preview')
    fireEvent.click(btn)
    // After switching to preview, label should say "Switch to source view"
    expect(screen.getByLabelText('Switch to source view')).toBeInTheDocument()
  })

  it('editor onChange works after toggling back from preview', () => {
    const onChange = vi.fn()
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/home/user/doc.md"
        content="# Hello"
        language="markdown"
        canToggle={true}
        initialMode="source"
        onChange={onChange}
      />
    )
    // Toggle to preview then back to source
    fireEvent.click(screen.getByLabelText('Switch to preview'))
    fireEvent.click(screen.getByLabelText('Switch to source view'))

    // Editor should still work
    const editor = screen.getByTestId('mock-editor')
    fireEvent.change(editor, { target: { value: '# Updated' } })
    expect(onChange).toHaveBeenCalledWith('# Updated')
  })

  it('images have no toggle (canToggle=false)', () => {
    render(
      <ExpandedViewerModal
        {...baseProps}
        filePath="/img/photo.png"
        language="image"
        content="data:image/png;base64,abc"
        initialMode="preview"
        canToggle={false}
      />
    )
    expect(screen.queryByLabelText('Switch to preview')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Switch to source view')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})
