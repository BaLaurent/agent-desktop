import { useState, useCallback } from 'react'
import type { Attachment } from '../../../shared/types'

interface FileDropZoneProps {
  children: React.ReactNode
  onFilesDropped: (files: Attachment[]) => void
}

export function FileDropZone({ children, onFilesDropped }: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const droppedFiles = Array.from(e.dataTransfer.files)
      if (droppedFiles.length === 0) return

      const attachments: Attachment[] = droppedFiles.map((file) => ({
        name: file.name,
        path: window.agent.system.getPathForFile(file),
        type: file.type || extToType(file.name),
        size: file.size,
      }))

      onFilesDropped(attachments)
    },
    [onFilesDropped]
  )

  return (
    <div
      className="relative flex-1 flex flex-col overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-overlay border-2 border-dashed border-primary">
          <span className="text-sm font-medium text-body">
            Drop files here
          </span>
        </div>
      )}
    </div>
  )
}

function extToType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    pdf: 'application/pdf',
    json: 'application/json',
    txt: 'text/plain',
    md: 'text/markdown',
    js: 'text/javascript',
    ts: 'text/typescript',
    py: 'text/x-python',
    csv: 'text/csv',
    yaml: 'text/yaml',
    yml: 'text/yaml',
  }
  return map[ext] ?? 'application/octet-stream'
}
