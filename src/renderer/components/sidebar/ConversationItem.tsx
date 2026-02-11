import { useState, useRef, useEffect } from 'react'
import type { Conversation, Folder } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'

interface Props {
  conversation: Conversation & { folder_name?: string }
  isActive: boolean
  depth?: number
}

export function ConversationItem({ conversation, isActive, depth = 0 }: Props) {
  const { setActiveConversation, updateConversation, deleteConversation, moveToFolder, exportConversation, folders } =
    useConversationsStore()
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(conversation.title)
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [showFolderSubmenu, setShowFolderSubmenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMenu])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setShowMenu(true)
  }

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
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', String(conversation.id))
          e.dataTransfer.effectAllowed = 'move'
          e.currentTarget.classList.add('sidebar-dragging')
        }}
        onDragEnd={(e) => {
          e.currentTarget.classList.remove('sidebar-dragging')
        }}
        onClick={() => setActiveConversation(conversation.id)}
        onDoubleClick={() => setIsRenaming(true)}
        onContextMenu={handleContextMenu}
        className="py-2 cursor-pointer transition-colors rounded mx-1"
        style={{
          paddingLeft: `${depth * 16 + 12}px`,
          paddingRight: '12px',
          backgroundColor: isActive ? 'var(--color-deep)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-bg)'
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
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
            className="w-full text-sm px-1 py-0.5 rounded outline-none"
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-primary)',
            }}
            aria-label="Rename conversation"
          />
        ) : (
          <>
            <div
              className="text-sm truncate font-medium"
              style={{ color: 'var(--color-text)' }}
            >
              {conversation.title}
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
            className="w-full text-left px-3 py-1.5 hover:opacity-80"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
            role="menuitem"
            aria-label="Rename conversation"
          >
            Rename
          </button>
          <div
            className="relative"
            onMouseEnter={() => setShowFolderSubmenu(true)}
            onMouseLeave={() => setShowFolderSubmenu(false)}
          >
            <button
              className="w-full text-left px-3 py-1.5 hover:opacity-80"
              style={{ backgroundColor: 'transparent' }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = 'transparent')
              }
            >
              Move to folder &rarr;
            </button>
            {showFolderSubmenu && (
              <div
                className="absolute left-full top-0 rounded shadow-lg py-1 text-sm min-w-[140px]"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-bg)',
                }}
              >
                <button
                  onClick={() => handleMoveToFolder(null)}
                  className="w-full text-left px-3 py-1.5"
                  style={{ backgroundColor: 'transparent' }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = 'transparent')
                  }
                >
                  No folder
                </button>
                {folders.map((f: Folder) => (
                  <button
                    key={f.id}
                    onClick={() => handleMoveToFolder(f.id)}
                    className="w-full text-left px-3 py-1.5"
                    style={{ backgroundColor: 'transparent' }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = 'transparent')
                    }
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => handleExport('markdown')}
            className="w-full text-left px-3 py-1.5"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
            role="menuitem"
            aria-label="Export conversation as Markdown"
          >
            Export as Markdown
          </button>
          <button
            onClick={() => handleExport('json')}
            className="w-full text-left px-3 py-1.5"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
            role="menuitem"
            aria-label="Export conversation as JSON"
          >
            Export as JSON
          </button>
          <button
            onClick={handleGenerateTitle}
            className="w-full text-left px-3 py-1.5"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
            role="menuitem"
            aria-label="Generate title with AI"
          >
            Generate Title
          </button>
          <div className="border-t my-1" style={{ borderColor: 'var(--color-bg)' }} />
          <button
            onClick={handleDelete}
            className="w-full text-left px-3 py-1.5"
            style={{ backgroundColor: 'transparent', color: 'var(--color-error)' }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
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
