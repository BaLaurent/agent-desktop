import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Mock mermaid — return controlled SVG so we test DOMPurify behavior
const mockRender = vi.fn()
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => mockRender(...args),
  },
}))

// Import the REAL sanitizer (scoped DOMPurify instance + uponSanitizeAttribute hook
// + config) so the tests cannot drift from production behavior.
import { MermaidBlock, sanitizeMermaidSvg } from './MermaidBlock'

/** textContent of a sanitized SVG string, whitespace-collapsed */
function textOf(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

describe('MermaidBlock', () => {
  beforeEach(() => {
    mockRender.mockReset()
  })

  describe('DOMPurify sanitization', () => {
    it('preserves label text inside foreignObject (Mermaid v11 htmlLabels)', () => {
      // Mermaid v11 renders ALL node/edge label text as XHTML inside <foreignObject>.
      // DOMPurify drops HTML children of an SVG <foreignObject> unless foreignobject is
      // registered as an HTML integration point — without that, diagrams render textless.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
        <foreignObject width="100" height="50">
          <div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>Hello World</p></span></div>
        </foreignObject>
      </svg>`

      const result = sanitizeMermaidSvg(svg)

      expect(result.toLowerCase()).toContain('foreignobject')
      expect(textOf(result)).toContain('Hello World')
    })

    it('preserves use elements with xlink:href', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100">
        <defs><marker id="arrow"><path d="M0,0 L10,5 L0,10"/></marker></defs>
        <use xlink:href="#arrow" x="50" y="50"/>
      </svg>`

      const result = sanitizeMermaidSvg(svg)

      expect(result).toContain('<use')
      expect(result).toContain('xlink:href')
      expect(result).toContain('#arrow')
    })

    it('strips script tags', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
        <script>alert('xss')</script>
        <text>Safe text</text>
      </svg>`

      const result = sanitizeMermaidSvg(svg)

      expect(result).not.toContain('<script')
      expect(result).not.toContain('alert')
      expect(result).toContain('Safe text')
    })

    it('strips event handler attributes', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
        <rect width="100" height="50" onclick="alert('xss')" onload="alert('load')" onerror="alert('err')"/>
        <text onmouseover="alert('hover')">Click me</text>
      </svg>`

      const result = sanitizeMermaidSvg(svg)

      expect(result).not.toContain('onclick')
      expect(result).not.toContain('onload')
      expect(result).not.toContain('onerror')
      expect(result).not.toContain('onmouseover')
      expect(result).toContain('Click me')
    })

    it('preserves dominant-baseline attribute', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg">
        <text dominant-baseline="middle">Centered</text>
      </svg>`

      const result = sanitizeMermaidSvg(svg)

      expect(result).toContain('dominant-baseline')
    })

    it('strips dangerous content from foreignObject HTML while keeping safe text', () => {
      // Enabling foreignObject as an HTML integration point must NOT reopen XSS:
      // script/event-handler/non-anchor-href stripping still applies to its children.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <foreignObject width="10" height="10">
          <div xmlns="http://www.w3.org/1999/xhtml">
            <span onclick="alert(1)">CLICKABLE</span>
            <script>alert('xss')</script>
            <a href="javascript:alert(2)">LINK</a>
          </div>
        </foreignObject>
      </svg>`

      const result = sanitizeMermaidSvg(svg)

      expect(textOf(result)).toContain('CLICKABLE')
      expect(textOf(result)).toContain('LINK')
      expect(result).not.toContain('<script')
      expect(result).not.toContain('onclick')
      expect(result).not.toContain('javascript:')
    })
  })

  describe('rendering', () => {
    it('shows error message on render failure', async () => {
      mockRender.mockRejectedValue(new Error('Parse error on line 1'))

      render(<MermaidBlock content="invalid mermaid" />)

      await waitFor(() => {
        expect(screen.getByText(/Mermaid error:/)).toBeInTheDocument()
        expect(screen.getByText(/Parse error on line 1/)).toBeInTheDocument()
      })
    })

    it('shows loading state before render completes', () => {
      mockRender.mockReturnValue(new Promise(() => {})) // never resolves

      render(<MermaidBlock content="graph TD; A-->B" />)

      expect(screen.getByText('Rendering diagram...')).toBeInTheDocument()
    })

    it('renders sanitized SVG into the DOM', async () => {
      mockRender.mockResolvedValue({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text>Diagram</text></svg>',
      })

      const { container } = render(<MermaidBlock content="graph TD; A-->B" />)

      await waitFor(() => {
        expect(container.querySelector('svg')).not.toBeNull()
        expect(container.querySelector('text')?.textContent).toBe('Diagram')
      })
    })
  })
})
