import type { Attachment } from '../../../shared/types'

interface AttachmentPreviewProps {
  attachments: Attachment[]
  onRemove: (index: number) => void
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function AttachmentPreview({ attachments, onRemove }: AttachmentPreviewProps) {
  if (attachments.length === 0) return null

  return (
    <div className="flex gap-2 px-3 py-2 overflow-x-auto">
      {attachments.map((file, index) => {
        const ext = getExt(file.name)
        const isImage = IMAGE_EXTS.has(ext)

        return (
          <div
            key={`${file.path}-${index}`}
            className="relative flex-shrink-0 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs max-w-[200px] bg-deep text-body"
          >
            {isImage ? (
              <img
                src={`file://${file.path}`}
                alt={file.name}
                className="w-8 h-8 rounded object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 text-[10px] font-bold uppercase bg-surface text-muted">
                {ext || '?'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{file.name}</div>
              <div className="text-muted">{formatSize(file.size)}</div>
            </div>
            <button
              onClick={() => onRemove(index)}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] leading-none bg-error text-contrast"
            >
              x
            </button>
          </div>
        )
      })}
    </div>
  )
}
