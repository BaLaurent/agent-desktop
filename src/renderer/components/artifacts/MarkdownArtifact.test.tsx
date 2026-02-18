vi.mock('./MermaidBlock', () => ({
  MermaidBlock: ({ content }: { content: string }) => (
    <div data-testid="mock-mermaid">{content}</div>
  ),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { MarkdownArtifact } from './MarkdownArtifact'

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

describe('MarkdownArtifact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders markdown content', () => {
    render(<MarkdownArtifact content="Hello **world**" />)
    expect(screen.getByText('world')).toBeInTheDocument()
  })

  it('generates slugified IDs on headings', () => {
    render(<MarkdownArtifact content="## My Heading" />)
    const heading = screen.getByText('My Heading')
    expect(heading.id).toBe('my-heading')
  })

  it('preserves accented characters in heading IDs', () => {
    render(<MarkdownArtifact content="## Sécurité" />)
    const heading = screen.getByText('Sécurité')
    expect(heading.id).toBe('sécurité')
  })

  it('strips apostrophes from heading IDs', () => {
    render(<MarkdownArtifact content="## L'introduction" />)
    const heading = screen.getByText("L'introduction")
    expect(heading.id).toBe('lintroduction')
  })

  it('generates IDs for h1, h2, h3', () => {
    render(<MarkdownArtifact content={'# Title\n## Section\n### Sub'} />)
    expect(screen.getByText('Title').id).toBe('title')
    expect(screen.getByText('Section').id).toBe('section')
    expect(screen.getByText('Sub').id).toBe('sub')
  })

  describe('anchor links', () => {
    it('scrolls to anchor on # link click', () => {
      render(<MarkdownArtifact content={'## Target\n\n[Go](#target)'} />)
      fireEvent.click(screen.getByText('Go'))
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
    })

    it('does not call openExternal for anchor links', () => {
      render(<MarkdownArtifact content={'## Section\n\n[link](#section)'} />)
      fireEvent.click(screen.getByText('link'))
      expect(window.agent.system.openExternal).not.toHaveBeenCalled()
    })

    it('calls openExternal for http links', async () => {
      render(<MarkdownArtifact content="[link](https://example.com)" />)
      fireEvent.click(screen.getByText('link'))
      expect(window.agent.system.openExternal).toHaveBeenCalledWith('https://example.com')
      await vi.mocked(window.agent.system.openExternal).mock.results[0]?.value
    })
  })
})
