import { useState, useRef, useEffect, useCallback } from 'react'
import type { Conversation, Folder } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'
import { useSchedulerStore } from '../../stores/schedulerStore'
import { useMobileMode } from '../../hooks/useMobileMode'

interface Props {
  conversation: Conversation & { folder_name?: string }
  isActive: boolean
  depth?: number
}

export function ConversationItem({ conversation, isActive, depth = 0 }: Props) {
  const isMobile = useMobileMode()
  const { setActiveConversation, updateConversation, deleteConversation, moveToFolder, exportConversation, folders } =
    useConversationsStore()
  const hasScheduledTask = useSchedulerStore((s) => s.tasks.some((t) => t.conversation_id === conversation.id))
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(conversation.title)
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [showFolderSubmenu, setShowFolderSubmenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  useEffect(() => {
    if (!showMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        setShowFolderSubmenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('touchstart', handleClick as EventListener)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick as EventListener)
    }
  }, [showMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setShowMenu(true)
  }

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

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== conversation.title) {
      updateConversation(conversation.id, { title: trimmed })
    }
    setIsRenaming(false)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit()
    if (e.key === 'Escape') {
      setRenameValue(conversation.title)
      setIsRenaming(false)
    }
  }

  const handleDelete = () => {
    setShowMenu(false)
    if (confirm(`Delete "${conversation.title}"?`)) {
      deleteConversation(conversation.id)
    }
  }

  const handleExport = async (format: 'markdown' | 'json') => {
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
  }

  const handleMoveToFolder = (folderId: number | null) => {
    setShowMenu(false)
    setShowFolderSubmenu(false)
    moveToFolder(conversation.id, folderId)
  }

  const handleGenerateTitle = async () => {
    setShowMenu(false)
    await window.agent.conversations.generateTitle(conversation.id)
  }

  const timeAgo = formatTimeAgo(conversation.updated_at)

  return (
    <>
      <div
        {...(!isMobile ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData('text/plain', String(conversation.id))
            e.dataTransfer.effectAllowed = 'move'
            e.currentTarget.classList.add('sidebar-dragging')
          },
          onDragEnd: (e: React.DragEvent) => {
            e.currentTarget.classList.remove('sidebar-dragging')
          },
          onDoubleClick: () => setIsRenaming(true),
        } : {})}
        onClick={() => setActiveConversation(conversation.id)}
        onContextMenu={!isMobile ? handleContextMenu : undefined}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        className={`group py-2 cursor-pointer transition-colors rounded mx-1 ${!isActive ? 'hover:bg-[var(--color-bg)]' : ''}`}
        style={{
          paddingLeft: `${depth * 16 + 12}px`,
          paddingRight: '12px',
          backgroundColor: isActive ? 'var(--color-deep)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
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
            className={`w-full ${isMobile ? 'text-base' : 'text-sm'} px-1 py-0.5 rounded outline-none`}
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
                style={{ color: 'var(--color-text)' }}
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
              {isMobile && (
                <button
                  onClick={handleThreeDotClick}
                  className="p-2.5 rounded flex-shrink-0 hover:bg-[var(--color-surface)]"
                  style={{ color: 'var(--color-text-muted)' }}
                  aria-label="Conversation actions"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="4" r="1.5" />
                    <circle cx="10" cy="10" r="1.5" />
                    <circle cx="10" cy="16" r="1.5" />
                  </svg>
                </button>
              )}
            </div>
            <div
              className="text-xs mt-0.5 truncate"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {timeAgo}
            </div>
          </>
        )}
      </div>

      {showMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded shadow-lg py-1 text-sm min-w-[160px]"
          style={{
            left: menuPos.x,
            top: menuPos.y,
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-bg)',
            color: 'var(--color-text)',
          }}
          role="menu"
          aria-label="Conversation actions"
        >
          <button
            onClick={() => {
              setShowMenu(false)
              setIsRenaming(true)
            }}
            className={`w-full text-left px-3 ${isMobile ? 'py-2.5' : 'py-1.5'} hover:bg-[var(--color-bg)]`}
            style={{ backgroundColor: 'transparent' }}
            role="menuitem"
            aria-label="Rename conversation"
          >
            Rename
          </button>
          <div
            className="relative"
            {...(!isMobile ? {
              onMouseEnter: () => setShowFolderSubmenu(true),
              onMouseLeave: () => setShowFolderSubmenu(false),
            } : {})}
          >
            <button
              className={`w-full text-left px-3 ${isMobile ? 'py-2.5' : 'py-1.5'} hover:bg-[var(--color-bg)]`}
              style={{ backgroundColor: 'transparent' }}
              {...(isMobile ? {
                onClick: () => setShowFolderSubmenu((v) => !v),
              } : {})}
            >
              Move to folder &rarr;
            </button>
            {showFolderSubmenu && (
              <div
                className={`${isMobile ? 'pl-3' : 'absolute left-full top-0'} rounded shadow-lg py-1 text-sm min-w-[140px]`}
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: isMobile ? 'none' : '1px solid var(--color-bg)',
                }}
              >
                <button
                  onClick={() => handleMoveToFolder(null)}
                  className={`w-full text-left px-3 ${isMobile ? 'py-2.5' : 'py-1.5'} hover:bg-[var(--color-bg)]`}
                  style={{ backgroundColor: 'transparent' }}
                >
                  No folder
                </button>
                {folders.map((f: Folder) => (
                  <button
                    key={f.id}
                    onClick={() => handleMoveToFolder(f.id)}
                    className={`w-full text-left px-3 ${isMobile ? 'py-2.5' : 'py-1.5'} hover:bg-[var(--color-bg)]`}
                    style={{ backgroundColor: 'transparent' }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => handleExport('markdown')}
            className={`w-full text-left px-3 ${isMobile ? 'py-2.5' : 'py-1.5'} hover:bg-[var(--color-bg)]`}
            style={{ backgroundColor: 'transparent' }}
            role="menuitem"
            aria-label="Export conversation as Markdown"
          >
            Export as Markdown
          </button>
          <button
            onClick={() => handleExport('json')}
            className={`w-full text-left px-3 ${isMobile ? 'py-2.5' : 'py-1.5'} hover:bg-[var(--color-bg)]`}
            style={{ backgroundColor: 'transparent' }}
            role="menuitem"
            aria-label="Export conversation as JSON"
          >
            Export as JSON
          </button>
          <button
            onClick={handleGenerateTitle}
            className={`w-full text-left px-3 ${isMobile ? 'py-2.5' : 'py-1.5'} hover:bg-[var(--color-bg)]`}
            style={{ backgroundColor: 'transparent' }}
            role="menuitem"
            aria-label="Generate title with AI"
          >
            Generate Title
          </button>
          <div className="border-t my-1" style={{ borderColor: 'var(--color-bg)' }} />
          <button
            onClick={handleDelete}
            className={`w-full text-left px-3 ${isMobile ? 'py-2.5' : 'py-1.5'} hover:bg-[var(--color-bg)]`}
            style={{ backgroundColor: 'transparent', color: 'var(--color-error)' }}
            role="menuitem"
            aria-label="Delete conversation"
          >
            Delete
          </button>
        </div>
      )}
    </>
  )
}

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
