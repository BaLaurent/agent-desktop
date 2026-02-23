import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import DOMPurify from 'dompurify'

// Mock mermaid — return controlled SVG so we test DOMPurify behavior
const mockRender = vi.fn()
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => mockRender(...args),
  },
}))

import { MermaidBlock } from './MermaidBlock'

/** The DOMPurify config used in MermaidBlock — duplicated here for direct unit testing */
const SANITIZE_CONFIG: DOMPurify.Config = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ['foreignobject', 'use'],
  ADD_ATTR: ['dominant-baseline', 'xlink:href'],
  FORBID_TAGS: ['script'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur'],
}

describe('MermaidBlock', () => {
  beforeEach(() => {
    mockRender.mockReset()
  })

  describe('DOMPurify sanitization', () => {
    it('preserves foreignObject element (not stripped by sanitizer)', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
        <foreignObject width="100" height="50">
          <div xmlns="http://www.w3.org/1999/xhtml">Hello World</div>
        </foreignObject>
      </svg>`

      const result = DOMPurify.sanitize(svg, SANITIZE_CONFIG)

      // jsdom serializes as camelCase foreignObject; browsers may use lowercase
      expect(result.toLowerCase()).toContain('foreignobject')
      // HTML content inside foreignObject is stripped in jsdom (namespace limitation)
      // but preserved in real browsers — the key assertion is that foreignObject itself survives
    })

    it('preserves use elements with xlink:href', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100">
        <defs><marker id="arrow"><path d="M0,0 L10,5 L0,10"/></marker></defs>
        <use xlink:href="#arrow" x="50" y="50"/>
      </svg>`

      const result = DOMPurify.sanitize(svg, SANITIZE_CONFIG)

      expect(result).toContain('<use')
      expect(result).toContain('xlink:href')
      expect(result).toContain('#arrow')
    })

    it('strips script tags', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
        <script>alert('xss')</script>
        <text>Safe text</text>
      </svg>`

      const result = DOMPurify.sanitize(svg, SANITIZE_CONFIG)

      expect(result).not.toContain('<script')
      expect(result).not.toContain('alert')
      expect(result).toContain('Safe text')
    })

    it('strips event handler attributes', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
        <rect width="100" height="50" onclick="alert('xss')" onload="alert('load')" onerror="alert('err')"/>
        <text onmouseover="alert('hover')">Click me</text>
      </svg>`

      const result = DOMPurify.sanitize(svg, SANITIZE_CONFIG)

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

      const result = DOMPurify.sanitize(svg, SANITIZE_CONFIG)

      expect(result).toContain('dominant-baseline')
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
