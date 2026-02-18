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

import { render, screen, fireEvent } from '@testing-library/react'
import { PreviewModal } from './PreviewModal'

describe('PreviewModal', () => {
  const defaultProps = {
    filePath: '/home/user/doc.md',
    content: '# Hello',
    language: 'markdown' as string | null,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the filename in the header', () => {
    render(<PreviewModal {...defaultProps} />)
    expect(screen.getByText('doc.md')).toBeInTheDocument()
  })

  it('renders markdown viewer for .md files', () => {
    render(<PreviewModal {...defaultProps} />)
    expect(screen.getByTestId('mock-markdown')).toBeInTheDocument()
  })

  it('renders image viewer when language is image', () => {
    render(<PreviewModal {...defaultProps} filePath="/img/photo.png" language="image" content="data:image/png;base64,abc" />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc')
    expect(img).toHaveAttribute('alt', 'photo.png')
  })

  it('renders SVG viewer for .svg files', () => {
    render(<PreviewModal {...defaultProps} filePath="/test/icon.svg" content="<svg></svg>" />)
    expect(screen.getByTestId('mock-svg')).toBeInTheDocument()
  })

  it('renders HTML viewer for .html files', () => {
    render(<PreviewModal {...defaultProps} filePath="/test/page.html" content="<h1>Hi</h1>" allowScripts />)
    const el = screen.getByTestId('mock-html-preview')
    expect(el).toHaveAttribute('data-filepath', '/test/page.html')
    expect(el).toHaveAttribute('data-scripts', 'true')
  })

  it('renders HTML viewer for .htm files', () => {
    render(<PreviewModal {...defaultProps} filePath="/test/page.htm" content="<h1>Hi</h1>" />)
    expect(screen.getByTestId('mock-html-preview')).toBeInTheDocument()
  })

  it('renders Mermaid viewer for .mmd files', () => {
    render(<PreviewModal {...defaultProps} filePath="/test/diagram.mmd" content="graph TD; A-->B" />)
    expect(screen.getByTestId('mock-mermaid')).toBeInTheDocument()
  })

  it('renders fallback for unknown preview types', () => {
    render(<PreviewModal {...defaultProps} filePath="/test/data.json" language="json" content="{}" />)
    expect(screen.getByText('No preview available')).toBeInTheDocument()
  })

  it('Close button calls onClose', () => {
    render(<PreviewModal {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Close preview'))
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('Escape key calls onClose', () => {
    render(<PreviewModal {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('non-Escape keys do not trigger close', () => {
    render(<PreviewModal {...defaultProps} />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('backdrop click calls onClose', () => {
    render(<PreviewModal {...defaultProps} />)
    const backdrop = screen.getByText('doc.md').closest('.fixed')!
    fireEvent.click(backdrop)
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('clicking inside the modal does not call onClose', () => {
    render(<PreviewModal {...defaultProps} />)
    fireEvent.click(screen.getByText('doc.md'))
    expect(defaultProps.onClose).not.toHaveBeenCalled()
  })

  it('renders .markdown extension as markdown', () => {
    render(<PreviewModal {...defaultProps} filePath="/readme.markdown" content="## Title" />)
    expect(screen.getByTestId('mock-markdown')).toBeInTheDocument()
  })
})
