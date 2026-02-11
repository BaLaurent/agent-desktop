interface HtmlPreviewProps {
  /** Raw HTML string — used for chat artifacts (sandboxed, no resource loading) */
  content?: string
  /** Absolute file path — used for file explorer preview (loads via agent-preview: protocol) */
  filePath?: string
  /** Allow JavaScript execution in file preview mode (default: false) */
  allowScripts?: boolean
}

export function HtmlPreview({ content, filePath, allowScripts }: HtmlPreviewProps) {
  // File preview mode: use custom protocol so relative resources (CSS, images, fonts) resolve
  // localhost hostname prevents standard-scheme URL normalization from eating the first path segment
  if (filePath) {
    const previewUrl = `agent-preview://localhost${encodeURI(filePath)}`
    const sandbox = allowScripts ? 'allow-same-origin allow-scripts' : 'allow-same-origin'
    return (
      <iframe
        key={`${previewUrl}-${sandbox}`}
        src={previewUrl}
        sandbox={sandbox}
        referrerPolicy="no-referrer"
        className="w-full h-full border border-muted bg-white"
        title="HTML Preview"
      />
    )
  }

  // Chat artifact mode: inline srcdoc, maximum sandbox restriction
  return (
    <iframe
      srcDoc={content}
      sandbox=""
      referrerPolicy="no-referrer"
      className="w-full h-full border border-muted bg-white"
      title="HTML Preview"
    />
  )
}
