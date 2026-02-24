import { useRef, useCallback, useEffect } from 'react'
import { useMobileMode } from '../../hooks/useMobileMode'
import { fileToAttachment } from '../../utils/fileToAttachment'
import type { Attachment } from '../../../shared/types'

interface FileUploadButtonProps {
  onFilesSelected: (files: Attachment[]) => void
}

const ACCEPTED =
  '.txt,.md,.js,.ts,.py,.json,.csv,.yaml,.yml,.pdf,.png,.jpg,.jpeg,.gif,.svg,.webp'

const PENDING_UPLOAD_KEY = 'agent_pendingUpload'

export function FileUploadButton({ onFilesSelected }: FileUploadButtonProps) {
  const mobile = useMobileMode()
  const inputRef = useRef<HTMLInputElement>(null)

  // Web mode: if page reloaded with a pending upload flag, re-open the file picker
  useEffect(() => {
    if (!mobile) return
    const pending = sessionStorage.getItem(PENDING_UPLOAD_KEY)
    if (pending) {
      sessionStorage.removeItem(PENDING_UPLOAD_KEY)
      // Small delay to let the page finish rendering
      setTimeout(() => inputRef.current?.click(), 500)
    }
  }, [mobile])

  const handleClick = useCallback(() => {
    // Web mode: save flag so we can re-open picker if page reloads
    if ((window as any).__AGENT_WEB_MODE__) {
      sessionStorage.setItem(PENDING_UPLOAD_KEY, '1')
    }
    inputRef.current?.click()
  }, [])

  const handleChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      // Upload succeeded (or was cancelled) — clear the pending flag
      sessionStorage.removeItem(PENDING_UPLOAD_KEY)

      const fileList = e.target.files
      if (!fileList || fileList.length === 0) return

      const attachments = await Promise.all(
        Array.from(fileList).map((file) => fileToAttachment(file))
      )

      onFilesSelected(attachments.filter((a): a is Attachment => a !== null))

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
        className={`flex-shrink-0 rounded-md flex items-center justify-center transition-opacity hover:opacity-80 ${mobile ? 'w-11 h-11' : 'w-8 h-8'}`}
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
