import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidBlock } from './MermaidBlock'

interface MarkdownArtifactProps {
  content: string
}

export function MarkdownArtifact({ content }: MarkdownArtifactProps) {
  return (
    <div
      className="h-full overflow-auto p-4 leading-relaxed"
      style={{ color: 'var(--color-text)' }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold mt-6 mb-3">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-bold mt-5 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="my-2 leading-relaxed">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-6 my-2 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 my-2 space-y-1">{children}</ol>
          ),
          code: ({ className, children }) => {
            const isBlock = className?.startsWith('language-')
            if (className === 'language-mermaid') {
              const text = typeof children === 'string' ? children : String(children ?? '')
              return <MermaidBlock content={text} />
            }
            if (isBlock) {
              return (
                <pre
                  className="rounded-md p-3 my-3 overflow-x-auto text-sm"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }}
                >
                  <code>{children}</code>
                </pre>
              )
            }
            return (
              <code
                className="px-1.5 py-0.5 rounded text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-primary)',
                }}
              >
                {children}
              </code>
            )
          },
          pre: ({ children }) => <>{children}</>,
          blockquote: ({ children }) => (
            <blockquote
              className="pl-4 my-3 italic"
              style={{
                borderLeft: '3px solid var(--color-primary)',
                color: 'var(--color-text-muted)',
              }}
            >
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="underline hover:opacity-80 transition-opacity"
              style={{ color: 'var(--color-primary)' }}
              onClick={(e) => {
                e.preventDefault()
                if (href) window.agent.system.openExternal(href)
              }}
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table
                className="w-full text-sm border-collapse"
                style={{ borderColor: 'var(--color-text-muted)' }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              className="text-left px-3 py-2 font-semibold border-b"
              style={{
                borderColor: 'var(--color-text-muted)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className="px-3 py-2 border-b"
              style={{ borderColor: 'var(--color-surface)' }}
            >
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
