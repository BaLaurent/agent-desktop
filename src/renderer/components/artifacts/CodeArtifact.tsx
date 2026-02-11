import { useEffect, useRef } from 'react'
import hljs from 'highlight.js'

interface CodeArtifactProps {
  content: string
  language: string | null
}

export function CodeArtifact({ content, language }: CodeArtifactProps) {
  const codeRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!codeRef.current) return
    codeRef.current.textContent = content
    if (language) {
      try {
        hljs.highlightElement(codeRef.current)
      } catch {
        // Language not supported — leave as plain text
      }
    }
  }, [content, language])

  const lines = content.split('\n')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Language label */}
      <div
        className="flex items-center px-3 py-1.5 text-xs shrink-0"
        style={{
          backgroundColor: 'var(--color-deep)',
          color: 'var(--color-text-muted)',
        }}
      >
        {language || 'text'}
      </div>

      {/* Code with line numbers */}
      <div className="flex-1 overflow-auto">
        <div className="flex text-sm leading-relaxed">
          {/* Line numbers */}
          <div
            className="select-none text-right pr-3 pl-2 py-3 shrink-0"
            style={{
              color: 'var(--color-text-muted)',
              backgroundColor: 'var(--color-surface)',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              minWidth: '3rem',
            }}
          >
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          {/* Code content */}
          <pre
            className="flex-1 p-3 overflow-x-auto m-0"
            style={{
              backgroundColor: 'var(--color-surface)',
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          >
            <code
              ref={codeRef}
              className={language ? `language-${language}` : ''}
            >
              {content}
            </code>
          </pre>
        </div>
      </div>
    </div>
  )
}
