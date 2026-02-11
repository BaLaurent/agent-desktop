import { useState, useCallback } from 'react'

interface CodeBlockProps {
  language?: string
  children: string
  defaultCollapsed?: boolean
}

export function CodeBlock({ language, children, defaultCollapsed }: CodeBlockProps) {
  const lineCount = children.split('\n').length
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? lineCount > 10)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [children])

  return (
    <div
      className="rounded-md my-3 overflow-hidden"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 text-xs"
        style={{
          backgroundColor: 'var(--color-deep)',
          color: 'var(--color-text-muted)',
        }}
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
          style={{ color: 'var(--color-text-muted)' }}
          aria-expanded={!collapsed}
          aria-label={`Toggle code block (${lineCount} lines)`}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className="transition-transform"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >
            <path d="M2 3l3 3.5L8 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>{language || 'text'}</span>
          {collapsed && (
            <span style={{ opacity: 0.6 }}>{lineCount} lines</span>
          )}
        </button>
        <button
          onClick={handleCopy}
          className="px-2 py-0.5 rounded text-xs transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-muted)' }}
          aria-label="Copy code to clipboard"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Code content */}
      {!collapsed && (
        <pre className="p-3 overflow-x-auto text-sm leading-relaxed">
          <code className={language ? `language-${language}` : ''}>
            {children}
          </code>
        </pre>
      )}
    </div>
  )
}
