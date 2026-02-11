import { useRef, useCallback } from 'react'
import type { Attachment } from '../../../shared/types'

interface FileUploadButtonProps {
  onFilesSelected: (files: Attachment[]) => void
}

const ACCEPTED =
  '.txt,.md,.js,.ts,.py,.json,.csv,.yaml,.yml,.pdf,.png,.jpg,.jpeg,.gif,.svg,.webp'

export function FileUploadButton({ onFilesSelected }: FileUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files
      if (!fileList || fileList.length === 0) return

      const attachments: Attachment[] = Array.from(fileList).map((file) => ({
        name: file.name,
        path: window.agent.system.getPathForFile(file),
        type: file.type || 'application/octet-stream',
        size: file.size,
      }))

      onFilesSelected(attachments)

      // Reset so selecting the same file again triggers onChange
      e.target.value = ''
    },
    [onFilesSelected]
  )

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        onChange={handleChange}
        className="hidden"
      />
      <button
        onClick={handleClick}
        className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-opacity hover:opacity-80"
        style={{
          backgroundColor: 'var(--color-deep)',
          color: 'var(--color-text-muted)',
        }}
        title="Attach files"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
    </>
  )
}
