import { useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface OverlayResponseProps {
  content: string
}

export function OverlayResponse({ content }: OverlayResponseProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content])

  if (!content) return null

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto px-4 py-2 text-sm leading-relaxed"
      style={{
        maxHeight: 260,
        color: 'var(--color-text, #e0e0e0)',
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
