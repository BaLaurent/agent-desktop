import { memo, type ReactNode, type ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import { useFileExplorerStore } from '../../stores/fileExplorerStore'
import { useUiStore } from '../../stores/uiStore'
import type { Components } from 'react-markdown'

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as ReactElement).props.children)
  }
  return ''
}

interface MarkdownRendererProps {
  content: string
}

const components: Components = {
  code({ children, ...props }) {
    // Only inline code reaches here — block code is handled by pre()
    return (
      <code
        className="px-1.5 py-0.5 rounded text-sm"
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-primary)',
        }}
        {...props}
      >
        {children}
      </code>
    )
  },

  pre({ children, node }) {
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
    return (
      <CodeBlock language={language}>
        {extractText(children).replace(/\n$/, '')}
      </CodeBlock>
    )
  },

  a({ href, children }) {
    const isLocalPath = href?.startsWith('/')
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (!href) return
          if (isLocalPath) {
            useFileExplorerStore.getState().selectFile(href)
            if (!useUiStore.getState().panelVisible) {
              useUiStore.getState().togglePanel()
            }
          } else {
            window.agent.system.openExternal(href)
          }
        }}
        className="underline hover:opacity-80 transition-opacity"
        style={{ color: 'var(--color-primary)' }}
        title={isLocalPath ? 'Open in file viewer' : href}
      >
        {children}
      </a>
    )
  },

  table({ children }) {
    return (
      <div className="overflow-x-auto my-3">
        <table
          className="w-full text-sm border-collapse"
          style={{ borderColor: 'var(--color-text-muted)' }}
        >
          {children}
        </table>
      </div>
    )
  },

  th({ children }) {
    return (
      <th
        className="text-left px-3 py-2 font-semibold border-b"
        style={{
          borderColor: 'var(--color-text-muted)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        {children}
      </th>
    )
  },

  td({ children }) {
    return (
      <td
        className="px-3 py-2 border-b"
        style={{ borderColor: 'var(--color-surface)' }}
      >
        {children}
      </td>
    )
  },

  blockquote({ children }) {
    return (
      <blockquote
        className="pl-4 my-3 italic"
        style={{
          borderLeft: '3px solid var(--color-primary)',
          color: 'var(--color-text-muted)',
        }}
      >
        {children}
      </blockquote>
    )
  },

  h1({ children }) {
    return <h1 className="text-2xl font-bold mt-6 mb-3">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="text-xl font-bold mt-5 mb-2">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>
  },

  ul({ children }) {
    return <ul className="list-disc pl-6 my-2 space-y-1">{children}</ul>
  },
  ol({ children }) {
    return <ol className="list-decimal pl-6 my-2 space-y-1">{children}</ol>
  },

  p({ children }) {
    return <p className="my-2 leading-relaxed">{children}</p>
  },
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
