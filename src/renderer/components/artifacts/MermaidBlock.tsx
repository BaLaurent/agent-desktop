import { useEffect, useRef, useState, useCallback } from 'react'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'

mermaid.initialize({ startOnLoad: false, theme: 'dark' })

let nextId = 0

interface MermaidBlockProps {
  content: string
}

const ZOOM_MIN = 0.2
const ZOOM_MAX = 5
const ZOOM_STEP = 0.15

function MermaidViewer({ svgHtml, fullscreen, onToggleFullscreen }: {
  svgHtml: string
  fullscreen: boolean
  onToggleFullscreen: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panStart = useRef({ x: 0, y: 0 })

  // Reset zoom/pan when toggling fullscreen or content changes
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [fullscreen, svgHtml])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => {
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + delta * z))
    })
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    panStart.current = { ...pan }
    e.preventDefault()
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return
    setPan({
      x: panStart.current.x + (e.clientX - dragStart.current.x),
      y: panStart.current.y + (e.clientY - dragStart.current.y),
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    dragging.current = false
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, z * 1.3))
  }, [])

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, z / 1.3))
  }, [])

  const zoomPercent = Math.round(zoom * 100)

  const toolbar = (
    <div
      className="flex items-center gap-1 px-2 py-1 rounded"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-bg)' }}
    >
      <button
        onClick={zoomOut}
        className="px-1.5 py-0.5 rounded text-xs hover:opacity-80"
        style={{ color: 'var(--color-text)' }}
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>
      <span
        className="text-xs min-w-[3rem] text-center select-none"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {zoomPercent}%
      </span>
      <button
        onClick={zoomIn}
        className="px-1.5 py-0.5 rounded text-xs hover:opacity-80"
        style={{ color: 'var(--color-text)' }}
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>
      <div className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--color-bg)' }} />
      <button
        onClick={resetView}
        className="px-1.5 py-0.5 rounded text-xs hover:opacity-80"
        style={{ color: 'var(--color-text-muted)' }}
        title="Reset view"
      >
        Reset
      </button>
      <button
        onClick={onToggleFullscreen}
        className="px-1.5 py-0.5 rounded text-xs hover:opacity-80"
        style={{ color: 'var(--color-text-muted)' }}
        aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
      >
        {fullscreen ? '✕' : '⛶'}
      </button>
    </div>
  )

  return (
    <div className="flex flex-col h-full w-full">
      {/* Toolbar */}
      <div className="flex justify-center py-1 flex-shrink-0">
        {toolbar}
      </div>

      {/* Viewport */}
      <div
        ref={viewportRef}
        className="flex-1 overflow-hidden relative"
        style={{ cursor: dragging.current ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '50% 50%',
            transition: dragging.current ? 'none' : 'transform 0.1s ease-out',
          }}
          className="flex justify-center"
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>
    </div>
  )
}

export function MermaidBlock({ content }: MermaidBlockProps) {
  const [svgHtml, setSvgHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const id = `mermaid-block-${++nextId}`
    setError(null)
    setSvgHtml(null)

    mermaid.render(id, content.trim())
      .then(({ svg }) => {
        const sanitized = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ['script', 'foreignObject', 'use'],
          FORBID_ATTR: ['xlink:href'],
        })
        setSvgHtml(sanitized)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [content])

  // Escape key closes fullscreen
  useEffect(() => {
    if (!fullscreen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [fullscreen])

  if (error) {
    return (
      <pre
        className="rounded-md p-3 my-3 overflow-x-auto text-sm"
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-error)',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}
      >
        Mermaid error: {error}
      </pre>
    )
  }

  if (!svgHtml) {
    return (
      <div className="my-3 p-4 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
        Rendering diagram...
      </div>
    )
  }

  return (
    <>
      {/* Inline view */}
      <div className="my-3 rounded overflow-hidden" style={{ border: '1px solid var(--color-surface)', height: 300 }}>
        <MermaidViewer
          svgHtml={svgHtml}
          fullscreen={false}
          onToggleFullscreen={() => setFullscreen(true)}
        />
      </div>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ backgroundColor: 'var(--color-bg)' }}
        >
          <MermaidViewer
            svgHtml={svgHtml}
            fullscreen={true}
            onToggleFullscreen={() => setFullscreen(false)}
          />
        </div>
      )}
    </>
  )
}
