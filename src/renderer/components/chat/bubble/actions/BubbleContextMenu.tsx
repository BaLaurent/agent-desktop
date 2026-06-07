import { ContextMenu, ContextMenuItem } from '../../../shared/ContextMenu'

export interface BubbleContextMenuProps {
  position: { x: number; y: number }
  isUser: boolean
  isLast: boolean
  showTtsButton: boolean
  isSpeakingThis: boolean
  selectedText: string
  onClose: () => void
  onCopyMessage: (e: React.MouseEvent) => void
  onCopySelection: (text: string, e: React.MouseEvent) => void
  onPlayTts: () => void
  onStopTts: () => void
  onStartEdit?: () => void
  onRetry?: () => void
  onOpenTaskForm: () => void
  onRegenerate?: () => void
  onFork?: (messageId: number) => void
  messageId: number
}

export function BubbleContextMenu({
  position,
  isUser,
  isLast,
  showTtsButton,
  isSpeakingThis,
  selectedText,
  onClose,
  onCopyMessage,
  onCopySelection,
  onPlayTts,
  onStopTts,
  onStartEdit,
  onRetry,
  onOpenTaskForm,
  onRegenerate,
  onFork,
  messageId,
}: BubbleContextMenuProps) {
  return (
    <ContextMenu
      position={position}
      onClose={onClose}
      className="min-w-[140px]"
      aria-label="Message actions"
    >
      <ContextMenuItem onClick={((e: React.MouseEvent) => { onClose(); onCopyMessage(e) }) as () => void}>
        Copy Message
      </ContextMenuItem>

      {selectedText && (
        <ContextMenuItem onClick={((e: React.MouseEvent) => { onClose(); onCopySelection(selectedText, e) }) as () => void}>
          Copy Selection
        </ContextMenuItem>
      )}

      {showTtsButton && (
        <ContextMenuItem onClick={() => { onClose(); isSpeakingThis ? onStopTts() : onPlayTts() }}>
          {isSpeakingThis ? 'Stop TTS' : 'Play TTS'}
        </ContextMenuItem>
      )}

      {isUser && onStartEdit && (
        <ContextMenuItem onClick={() => { onClose(); onStartEdit() }}>
          Edit
        </ContextMenuItem>
      )}

      {isUser && onRetry && (
        <ContextMenuItem onClick={() => { onClose(); onRetry() }}>
          Retry
        </ContextMenuItem>
      )}

      {isUser && (
        <ContextMenuItem onClick={() => { onClose(); onOpenTaskForm() }}>
          Schedule
        </ContextMenuItem>
      )}

      {!isUser && isLast && onRegenerate && (
        <ContextMenuItem onClick={() => { onClose(); onRegenerate() }}>
          Retry
        </ContextMenuItem>
      )}

      {onFork && (
        <ContextMenuItem onClick={() => { onClose(); onFork(messageId) }}>
          Fork from here
        </ContextMenuItem>
      )}
    </ContextMenu>
  )
}
