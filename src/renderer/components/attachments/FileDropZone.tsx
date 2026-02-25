import { useState, useCallback } from 'react'
import { fileToAttachment } from '../../utils/fileToAttachment'
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
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const droppedFiles = Array.from(e.dataTransfer.files)
      if (droppedFiles.length === 0) return

      const attachments = await Promise.all(
        droppedFiles.map((file) => fileToAttachment(file))
      )

      onFilesDropped(attachments.filter((a): a is Attachment => a !== null))
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
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-overlay border-2 border-dashed border-primary mobile:hidden">
          <span className="text-sm font-medium text-body">
            Drop files here
          </span>
        </div>
      )}
    </div>
  )
}
