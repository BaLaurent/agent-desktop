import { useState, useRef, useEffect, useCallback, memo } from 'react'
import type { Conversation, Folder } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'
import { useShallow } from 'zustand/react/shallow'
import { useSchedulerStore } from '../../stores/schedulerStore'
import { useMobileMode } from '../../hooks/useMobileMode'
import { ContextMenu, ContextMenuItem, ContextMenuDivider } from '../shared/ContextMenu'
import { ColorSwatches, ColorPicker } from '../shared/ColorPicker'

function invertHex(hex: string): string {
  const r = 255 - parseInt(hex.slice(1, 3), 16)
  const g = 255 - parseInt(hex.slice(3, 5), 16)
  const b = 255 - parseInt(hex.slice(5, 7), 16)
  return `rgb(${r}, ${g}, ${b})`
}

/**
 * Returns a dark or light text color that ensures contrast against the given
 * hex background color, using the WCAG relative luminance formula.
 * Used when a card has an explicit background color (effectiveColor) so that
 * the text is always readable regardless of the current theme (dark/light).
 */
function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  // sRGB linearization
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  // Light background → dark text; dark background → light text
  return L > 0.35 ? '#1a1a1a' : '#f0f0f0'
}

interface Props {
  conversation: Conversation & { folder_name?: string }
  isActive: boolean
  isSelected: boolean
  visibleOrder: number[]
  depth?: number
  folderColor?: string | null
}

// Stable action selector — useShallow prevents new object reference on every render
const useActions = () => useConversationsStore(useShallow((s) => ({
  setActiveConversation: s.setActiveConversation,
  updateConversation: s.updateConversation,
  deleteConversation: s.deleteConversation,
  moveToFolder: s.moveToFolder,
  exportConversation: s.exportConversation,
  handleSelect: s.handleSelect,
  deleteSelected: s.deleteSelected,
  moveSelectedToFolder: s.moveSelectedToFolder,
  colorSelected: s.colorSelected,
  clearSelection: s.clearSelection,
})))

export const ConversationItem = memo(function ConversationItem({ conversation, isActive, isSelected, visibleOrder, depth = 0, folderColor }: Props) {
  const isMobile = useMobileMode()

  // Granular data selectors — only re-render when these specific values change
  const folders = useConversationsStore((s) => s.folders)
  const selectedIds = useConversationsStore((s) => s.selectedIds)
  const {
    setActiveConversation, updateConversation, deleteConversation, moveToFolder,
    exportConversation, handleSelect, deleteSelected, moveSelectedToFolder,
    colorSelected, clearSelection,
  } = useActions()

  // O(1) scheduled task lookup via derived Set (Task 2.5)
  const hasScheduledTask = useSchedulerStore((s) => s.taskConversationIds.has(conversation.id))

  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(conversation.title)
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [showFolderSubmenu, setShowFolderSubmenu] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [colorPickerPos, setColorPickerPos] = useState({ x: 0, y: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  const closeMenu = useCallback(() => {
    setShowMenu(false)
    setShowFolderSubmenu(false)
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setShowMenu(true)
  }, [])

  const openMenuAt = useCallback((x: number, y: number) => {
    setMenuPos({ x, y })
    setShowMenu(true)
  }, [])

  const handleThreeDotClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    openMenuAt(rect.left, rect.bottom + 4)
  }, [openMenuAt])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    const touch = e.touches[0]
    const x = touch.clientX
    const y = touch.clientY
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      openMenuAt(x, y)
    }, 500)
  }, [isMobile, openMenuAt])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== conversation.title) {
      updateConversation(conversation.id, { title: trimmed })
    }
    setIsRenaming(false)
  }, [renameValue, conversation.title, conversation.id, updateConversation])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit()
    if (e.key === 'Escape') {
      setRenameValue(conversation.title)
      setIsRenaming(false)
    }
  }, [handleRenameSubmit, conversation.title])

  const handleDelete = useCallback(() => {
    setShowMenu(false)
    if (confirm(`Delete "${conversation.title}"?`)) {
      deleteConversation(conversation.id)
    }
  }, [conversation.title, conversation.id, deleteConversation])

  const handleExport = useCallback(async (format: 'markdown' | 'json') => {
    setShowMenu(false)
    const data = await exportConversation(conversation.id, format)
    const ext = format === 'markdown' ? 'md' : 'json'
    const blob = new Blob([data], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${conversation.title}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }, [conversation.id, conversation.title, exportConversation])

  const handleMoveToFolder = useCallback((folderId: number | null) => {
    setShowMenu(false)
    setShowFolderSubmenu(false)
    moveToFolder(conversation.id, folderId)
  }, [conversation.id, moveToFolder])

  const handleGenerateTitle = useCallback(async () => {
    setShowMenu(false)
    await window.agent.conversations.generateTitle(conversation.id)
  }, [conversation.id])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault()
      handleSelect(conversation.id, e.ctrlKey || e.metaKey, e.shiftKey, visibleOrder)
    } else {
      handleSelect(conversation.id, false, false, visibleOrder)
    }
  }, [conversation.id, handleSelect, visibleOrder])

  const timeAgo = formatTimeAgo(conversation.updated_at)
  const effectiveColor = conversation.color || folderColor || null
  // When the card has a colored background, always use a contrasted text color
  // (dark on light cards, light on dark cards) — regardless of the current theme.
  const cardTextColor = effectiveColor ? getContrastColor(effectiveColor) : undefined
  const cardTextMutedColor = effectiveColor ? getContrastColor(effectiveColor) + 'aa' : undefined

  return (
    <>
      <div
        {...(!isMobile ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            // If this item is part of a multi-selection, drag all selected IDs
            const ids = isSelected && selectedIds.size > 1
              ? JSON.stringify([...selectedIds])
              : String(conversation.id)
            e.dataTransfer.setData('text/plain', ids)
            e.dataTransfer.effectAllowed = 'move'
            e.currentTarget.classList.add('sidebar-dragging')
          },
          onDragEnd: (e: React.DragEvent) => {
            e.currentTarget.classList.remove('sidebar-dragging')
          },
          onDoubleClick: () => setIsRenaming(true),
        } : {})}
        onClick={handleClick}
        onContextMenu={!isMobile ? handleContextMenu : undefined}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        className={`group py-2 cursor-pointer transition-colors rounded mx-1 ${!isActive && !isSelected ? 'hover:bg-[var(--color-bg)]' : ''}`}
        style={{
          paddingLeft: `${depth * 16 + 12}px`,
          paddingRight: '12px',
          backgroundColor: isActive
            ? (effectiveColor ? `color-mix(in srgb, ${effectiveColor} 12%, var(--color-deep))` : 'var(--color-deep)')
            : isSelected ? 'var(--color-bg)'
            : effectiveColor ? `color-mix(in srgb, ${effectiveColor} 8%, transparent)`
            : 'transparent',
          borderLeft: isActive ? '2px solid var(--color-primary)' : isSelected ? '2px solid var(--color-text-muted)' : '2px solid transparent',
          ...(isActive && effectiveColor ? {
            boxShadow: `0 0 8px 1px color-mix(in srgb, ${invertHex(effectiveColor)} 40%, transparent)`,
          } : {}),
        }}
        role="treeitem"
        aria-selected={isActive}
        aria-label={`Conversation: ${conversation.title}`}
      >
        {isRenaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            className="w-full text-sm mobile:text-base px-1 py-0.5 rounded outline-none"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-primary)',
            }}
            aria-label="Rename conversation"
          />
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <div
                className="text-sm truncate font-medium flex-1"
                style={{ color: cardTextColor ?? 'var(--color-text)' }}
              >
                {conversation.title}
              </div>
              {hasScheduledTask && (
                <svg
                  className="w-3 h-3 flex-shrink-0"
                  style={{ color: 'var(--color-primary)' }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-label="Has scheduled task"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <button
                onClick={handleThreeDotClick}
                className="hidden mobile:block p-2.5 rounded flex-shrink-0 hover:bg-[var(--color-surface)]"
                style={{ color: cardTextMutedColor ?? 'var(--color-text-muted)' }}
                aria-label="Conversation actions"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <circle cx="10" cy="4" r="1.5" />
                  <circle cx="10" cy="10" r="1.5" />
                  <circle cx="10" cy="16" r="1.5" />
                </svg>
              </button>
            </div>
            <div
              className="text-xs mt-0.5 truncate"
              style={{ color: cardTextMutedColor ?? 'var(--color-text-muted)' }}
            >
              {timeAgo}
            </div>
          </>
        )}
      </div>

      {showMenu && isSelected && selectedIds.size > 1 ? (
        <ContextMenu position={menuPos} onClose={closeMenu} className="min-w-[160px]" aria-label="Bulk conversation actions">
          <div
            className="relative"
            {...(!isMobile ? {
              onMouseEnter: () => setShowFolderSubmenu(true),
              onMouseLeave: () => setShowFolderSubmenu(false),
            } : {})}
          >
            <button
              className="w-full text-left px-3 py-1.5 mobile:py-2.5 hover:bg-[var(--color-bg)]"
              style={{ backgroundColor: 'transparent' }}
              {...(isMobile ? {
                onClick: () => setShowFolderSubmenu((v) => !v),
              } : {})}
            >
              Move {selectedIds.size} to folder &rarr;
            </button>
            {showFolderSubmenu && (
              <div
                className="absolute left-full top-0 mobile:static mobile:pl-3 rounded shadow-lg py-1 text-sm min-w-[140px] border border-[var(--color-bg)] mobile:border-0"
                style={{ backgroundColor: 'var(--color-surface)' }}
              >
                <button
                  onClick={() => { closeMenu(); moveSelectedToFolder(null) }}
                  className="w-full text-left px-3 py-1.5 mobile:py-2.5 hover:bg-[var(--color-bg)]"
                  style={{ backgroundColor: 'transparent' }}
                >
                  No folder
                </button>
                {folders.map((f: Folder) => (
                  <button
                    key={f.id}
                    onClick={() => { closeMenu(); moveSelectedToFolder(f.id) }}
                    className="w-full text-left px-3 py-1.5 mobile:py-2.5 hover:bg-[var(--color-bg)]"
                    style={{ backgroundColor: 'transparent' }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ColorSwatches
            currentColor={null}
            onColorChange={(c) => {
              colorSelected(c)
              setShowMenu(false)
            }}
            onOpenPicker={() => {
              setColorPickerPos({ x: menuPos.x, y: menuPos.y })
              setShowColorPicker(true)
              setShowMenu(false)
            }}
          />
          <ContextMenuDivider />
          <ContextMenuItem
            danger
            onClick={() => {
              setShowMenu(false)
              if (confirm(`Delete ${selectedIds.size} conversations?`)) {
                deleteSelected()
              }
            }}
          >
            Delete {selectedIds.size} conversations
          </ContextMenuItem>
        </ContextMenu>
      ) : showMenu && (
        <ContextMenu position={menuPos} onClose={closeMenu} className="min-w-[160px]" aria-label="Conversation actions">
          <ContextMenuItem
            onClick={() => { setShowMenu(false); setIsRenaming(true) }}
            aria-label="Rename conversation"
          >
            Rename
          </ContextMenuItem>
          <div
            className="relative"
            {...(!isMobile ? {
              onMouseEnter: () => setShowFolderSubmenu(true),
              onMouseLeave: () => setShowFolderSubmenu(false),
            } : {})}
          >
            <button
              className="w-full text-left px-3 py-1.5 mobile:py-2.5 hover:bg-[var(--color-bg)]"
              style={{ backgroundColor: 'transparent' }}
              {...(isMobile ? {
                onClick: () => setShowFolderSubmenu((v) => !v),
              } : {})}
            >
              Move to folder &rarr;
            </button>
            {showFolderSubmenu && (
              <div
                className="absolute left-full top-0 mobile:static mobile:pl-3 rounded shadow-lg py-1 text-sm min-w-[140px] border border-[var(--color-bg)] mobile:border-0"
                style={{ backgroundColor: 'var(--color-surface)' }}
              >
                <button
                  onClick={() => handleMoveToFolder(null)}
                  className="w-full text-left px-3 py-1.5 mobile:py-2.5 hover:bg-[var(--color-bg)]"
                  style={{ backgroundColor: 'transparent' }}
                >
                  No folder
                </button>
                {folders.map((f: Folder) => (
                  <button
                    key={f.id}
                    onClick={() => handleMoveToFolder(f.id)}
                    className="w-full text-left px-3 py-1.5 mobile:py-2.5 hover:bg-[var(--color-bg)]"
                    style={{ backgroundColor: 'transparent' }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ContextMenuItem onClick={() => handleExport('markdown')} aria-label="Export conversation as Markdown">
            Export as Markdown
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleExport('json')} aria-label="Export conversation as JSON">
            Export as JSON
          </ContextMenuItem>
          <ContextMenuItem onClick={handleGenerateTitle} aria-label="Generate title with AI">
            Generate Title
          </ContextMenuItem>
          <ContextMenuDivider />
          <ColorSwatches
            currentColor={conversation.color}
            onColorChange={(c) => {
              updateConversation(conversation.id, { color: c })
              setShowMenu(false)
            }}
            onOpenPicker={() => {
              setColorPickerPos({ x: menuPos.x, y: menuPos.y })
              setShowColorPicker(true)
              setShowMenu(false)
            }}
          />
          <ContextMenuDivider />
          <ContextMenuItem danger onClick={handleDelete} aria-label="Delete conversation">
            Delete
          </ContextMenuItem>
        </ContextMenu>
      )}

      {showColorPicker && (
        <ColorPicker
          currentColor={conversation.color}
          onColorChange={(c) => {
            if (selectedIds.size > 1) {
              colorSelected(c)
            } else {
              updateConversation(conversation.id, { color: c })
            }
          }}
          onClose={() => setShowColorPicker(false)}
          position={colorPickerPos}
        />
      )}
    </>
  )
})

function formatTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}
