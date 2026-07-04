interface HtmlPreviewProps {
  /** Raw HTML string — used for chat artifacts (sandboxed, no resource loading) */
  content?: string
  /** Absolute file path — used for file explorer preview (loads via the /preview/ route) */
  filePath?: string
  /** Allow JavaScript execution in file preview mode (default: false) */
  allowScripts?: boolean
}

export function HtmlPreview({ content, filePath, allowScripts }: HtmlPreviewProps) {
  // File preview mode: same-origin /preview/<abs-path> route (served by uiServer) so relative
  // resources (CSS, images, fonts) resolve against the file's directory (?base=<dir>)
  if (filePath) {
    const sepIdx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    const dir = sepIdx >= 0 ? filePath.substring(0, sepIdx) : filePath
    const previewUrl = `/preview${encodeURI(filePath)}?base=${encodeURIComponent(dir)}`
    const sandbox = allowScripts ? 'allow-scripts' : 'allow-same-origin'
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
