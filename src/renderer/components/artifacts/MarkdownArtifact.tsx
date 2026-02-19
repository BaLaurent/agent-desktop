import { useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidBlock } from './MermaidBlock'

interface MarkdownArtifactProps {
  content: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as any).props.children)
  }
  return ''
}

export function MarkdownArtifact({ content }: MarkdownArtifactProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const scrollToAnchor = (id: string) => {
    let decoded: string
    try { decoded = decodeURIComponent(id) } catch { decoded = id }
    const slug = slugify(decoded)
    const el = containerRef.current?.querySelector(`#${CSS.escape(slug)}`)
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto p-4 leading-relaxed"
      style={{ color: 'var(--color-text)' }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 id={slugify(extractText(children))} className="text-2xl font-bold mt-6 mb-3">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 id={slugify(extractText(children))} className="text-xl font-bold mt-5 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 id={slugify(extractText(children))} className="text-lg font-semibold mt-4 mb-2">{children}</h3>
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
          code: ({ children }) => (
            // Only inline code reaches here — block code is handled by pre()
            <code
              className="px-1.5 py-0.5 rounded text-sm"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-primary)',
              }}
            >
              {children}
            </code>
          ),
          pre: ({ children, node }) => {
            // Fenced code blocks: extract language from the hast <code> node
            const codeNode = (node as any)?.children?.[0]
            let language: string | undefined
            if (codeNode?.tagName === 'code') {
              const classNames = codeNode.properties?.className
              if (Array.isArray(classNames)) {
                const langClass = classNames.find((c: string) => c.startsWith('language-'))
                if (langClass) language = langClass.replace('language-', '')
              }
            }
            if (language === 'mermaid') {
              return <MermaidBlock content={extractText(children).replace(/\n$/, '')} />
            }
            return (
              <pre
                className="rounded-md p-3 my-3 overflow-x-auto text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                }}
              >
                <code>{extractText(children).replace(/\n$/, '')}</code>
              </pre>
            )
          },
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
                if (!href) return
                if (href.startsWith('#')) {
                  scrollToAnchor(href.slice(1))
                } else {
                  window.agent.system.openExternal(href)
                }
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
