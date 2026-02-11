import { useMemo } from 'react'
import DOMPurify from 'dompurify'

interface SvgPreviewProps {
  content: string
}

function sanitizeSvg(raw: string): string {
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'use'],
    FORBID_ATTR: ['xlink:href'],
  })
}

export function SvgPreview({ content }: SvgPreviewProps) {
  const sanitized = useMemo(() => sanitizeSvg(content), [content])

  return (
    <div
      className="h-full w-full overflow-auto flex items-center justify-center p-4"
      style={{ maxWidth: '100%', maxHeight: '100%' }}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  )
}
