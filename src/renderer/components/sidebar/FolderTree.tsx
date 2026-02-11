import { useState, useRef, useEffect, useMemo } from 'react'
import type { Folder } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ConversationItem } from './ConversationItem'
import { EmptyState } from './EmptyState'
import { FolderSettingsPopover } from '../settings/FolderSettingsPopover'
import type { McpServerName } from '../settings/FolderSettingsPopover'
import { useMcpStore } from '../../stores/mcpStore'

export function SidebarTree() {
  const {
    folders,
    conversations,
    activeConversationId,
    searchQuery,
    isLoading,
    createFolder,
    updateFolder,
    updateConversation,
    deleteFolder,
    moveToFolder,
    createConversation,
  } = useConversationsStore()

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menuFolderId, setMenuFolderId] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null)
  const [dragOverUnfiled, setDragOverUnfiled] = useState(false)
  const [overrideFolderId, setOverrideFolderId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const globalSettings = useSettingsStore((s) => s.settings)
  const mcpServers = useMcpStore((s) => s.servers)
  const loadMcpServers = useMcpStore((s) => s.loadServers)

  // Load MCP servers if not yet loaded
  useEffect(() => { loadMcpServers() }, [loadMcpServers])

  const mcpServerNames = useMemo<McpServerName[]>(
    () => mcpServers.filter((s) => s.enabled === 1).map((s) => ({ name: s.name })),
    [mcpServers]
  )

  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [renamingId])

  useEffect(() => {
    if (menuFolderId === null) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuFolderId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuFolderId])

  const isSearching = searchQuery.trim().length > 0

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleContextMenu = (e: React.MouseEvent, folderId: number) => {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuFolderId(folderId)
  }

  const handleRenameSubmit = (folderId: number) => {
    const trimmed = renameValue.trim()
    if (trimmed) {
      updateFolder(folderId, { name: trimmed })
    }
    setRenamingId(null)
  }

  const handleDelete = (folderId: number) => {
    setMenuFolderId(null)
    const folder = folders.find((f) => f.id === folderId)
    if (folder) {
      setDeleteTarget({ id: folder.id, name: folder.name })
    }
  }

  const getRecursiveConversationCount = (folderId: number): number => {
    const direct = conversations.filter((c) => c.folder_id === folderId).length
    const children = folders.filter((f) => f.parent_id === folderId)
    return direct + children.reduce((sum, f) => sum + getRecursiveConversationCount(f.id), 0)
  }

  const getRecursiveChildFolderCount = (folderId: number): number => {
    const children = folders.filter((f) => f.parent_id === folderId)
    return children.length + children.reduce((sum, f) => sum + getRecursiveChildFolderCount(f.id), 0)
  }

  const handleCreateSubfolder = (parentId: number) => {
    setMenuFolderId(null)
    createFolder('New Folder', parentId)
  }

  const handleNewConversationInFolder = async (folderId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const conv = await createConversation()
    await moveToFolder(conv.id, folderId)
    // Apply folder's default CWD to new conversation
    const folder = folders.find((f) => f.id === folderId)
    if (folder?.default_cwd) {
      await updateConversation(conv.id, { cwd: folder.default_cwd } as any)
    }
    setExpandedIds((prev) => new Set(prev).add(folderId))
  }

  const getConversationCount = (folderId: number): number => {
    return conversations.filter((c) => c.folder_id === folderId).length
  }

  const buildTree = (parentId: number | null): Folder[] => {
    return folders.filter((f) => f.parent_id === parentId)
  }

  const handleDrop = (e: React.DragEvent, folderId: number | null) => {
    e.preventDefault()
    setDragOverFolderId(null)
    setDragOverUnfiled(false)
    const conversationId = parseInt(e.dataTransfer.getData('text/plain'), 10)
    if (isNaN(conversationId)) return
    const conv = conversations.find((c) => c.id === conversationId)
    if (!conv || conv.folder_id === folderId) return
    moveToFolder(conversationId, folderId)
    if (folderId !== null) {
      setExpandedIds((prev) => new Set(prev).add(folderId))
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleFolderDragEnter = (e: React.DragEvent, folderId: number) => {
    e.preventDefault()
    setDragOverFolderId(folderId)
  }

  const handleFolderDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverFolderId(null)
    }
  }

  const handleUnfiledDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverUnfiled(true)
  }

  const handleUnfiledDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverUnfiled(false)
    }
  }

  const renderFolder = (folder: Folder, depth: number) => {
    const isExpanded = isSearching || expandedIds.has(folder.id)
    const children = buildTree(folder.id)
    const count = getConversationCount(folder.id)
    const folderConversations = conversations.filter((c) => c.folder_id === folder.id)
    const isDragOver = dragOverFolderId === folder.id

    return (
      <div key={folder.id}>
        <div
          className={`group flex items-center gap-1 px-2 py-1 cursor-pointer rounded mx-1 text-sm${isDragOver ? ' sidebar-drop-active' : ''}`}
          style={{
            paddingLeft: `${depth * 16 + 8}px`,
            color: 'var(--color-text)',
          }}
          onClick={() => toggleExpand(folder.id)}
          onContextMenu={(e) => handleContextMenu(e, folder.id)}
          onDrop={(e) => handleDrop(e, folder.id)}
          onDragOver={handleDragOver}
          onDragEnter={(e) => handleFolderDragEnter(e, folder.id)}
          onDragLeave={handleFolderDragLeave}
          onMouseEnter={(e) => {
            if (!isDragOver) e.currentTarget.style.backgroundColor = 'var(--color-bg)'
          }}
          onMouseLeave={(e) => {
            if (!isDragOver) e.currentTarget.style.backgroundColor = 'transparent'
          }}
          role="treeitem"
          aria-expanded={isExpanded}
          aria-label={`Folder: ${folder.name}`}
        >
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {children.length > 0 || count > 0 ? (isExpanded ? '\u25BE' : '\u25B8') : '\u2022'}
          </span>
          {renamingId === folder.id ? (
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => handleRenameSubmit(folder.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit(folder.id)
                if (e.key === 'Escape') setRenamingId(null)
              }}
              className="flex-1 text-sm px-1 rounded outline-none"
              style={{
                backgroundColor: 'var(--color-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-primary)',
              }}
              onClick={(e) => e.stopPropagation()}
              aria-label="Rename folder"
            />
          ) : (
            <>
              <span className="flex-1 truncate">{folder.name}</span>
              {count > 0 && (
                <span
                  className="text-xs px-1.5 rounded-full"
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {count}
                </span>
              )}
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--color-surface)]"
                onClick={(e) => handleNewConversationInFolder(folder.id, e)}
                title="New conversation in this folder"
                aria-label={`New conversation in ${folder.name}`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="8" x2="12" y2="14" />
                  <line x1="9" y1="11" x2="15" y2="11" />
                </svg>
              </button>
            </>
          )}
        </div>
        {isExpanded && (
          <>
            {folderConversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                depth={depth + 1}
              />
            ))}
            {children.map((child) => renderFolder(child, depth + 1))}
          </>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="px-3 py-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Loading...
      </div>
    )
  }

  if (conversations.length === 0) {
    return <EmptyState />
  }

  const rootFolders = buildTree(null)
  const unfiled = conversations.filter((c) => !c.folder_id)
  const hasFolders = rootFolders.length > 0

  return (
    <div className="flex-1 overflow-y-auto pb-2" role="tree" aria-label="Conversations tree">
      {rootFolders.map((folder) => renderFolder(folder, 0))}

      {unfiled.length > 0 && hasFolders && (
        <div
          className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider${dragOverUnfiled ? ' sidebar-drop-active' : ''}`}
          style={{ color: 'var(--color-text-muted)' }}
          onDrop={(e) => handleDrop(e, null)}
          onDragOver={handleDragOver}
          onDragEnter={handleUnfiledDragEnter}
          onDragLeave={handleUnfiledDragLeave}
        >
          Unfiled
        </div>
      )}
      {unfiled.map((conv) => (
        <ConversationItem
          key={conv.id}
          conversation={conv}
          isActive={conv.id === activeConversationId}
        />
      ))}

      {overrideFolderId !== null && (() => {
        const targetFolder = folders.find((f) => f.id === overrideFolderId)
        if (!targetFolder) return null
        return (
          <FolderSettingsPopover
            folder={targetFolder}
            globalSettings={globalSettings}
            mcpServers={mcpServerNames}
            onSave={(data) => {
              updateFolder(overrideFolderId, data as any)
              setOverrideFolderId(null)
            }}
            onClose={() => setOverrideFolderId(null)}
          />
        )
      })()}

      {menuFolderId !== null && (
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
        >
          <button
            onClick={() => {
              const folder = folders.find((f) => f.id === menuFolderId)
              if (folder) {
                setRenameValue(folder.name)
                setRenamingId(menuFolderId)
              }
              setMenuFolderId(null)
            }}
            className="w-full text-left px-3 py-1.5"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
          >
            Rename
          </button>
          <button
            onClick={() => handleCreateSubfolder(menuFolderId!)}
            className="w-full text-left px-3 py-1.5"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
          >
            Create subfolder
          </button>
          <button
            onClick={() => {
              setOverrideFolderId(menuFolderId)
              setMenuFolderId(null)
            }}
            className="w-full text-left px-3 py-1.5"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
          >
            Folder Settings
          </button>
          <div className="border-t my-1" style={{ borderColor: 'var(--color-bg)' }} />
          <button
            onClick={() => handleDelete(menuFolderId!)}
            className="w-full text-left px-3 py-1.5"
            style={{ backgroundColor: 'transparent', color: 'var(--color-error)' }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = 'var(--color-bg)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
          >
            Delete folder
          </button>
        </div>
      )}

      {deleteTarget && (() => {
        const convCount = getRecursiveConversationCount(deleteTarget.id)
        const childCount = getRecursiveChildFolderCount(deleteTarget.id)
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
            onClick={() => setDeleteTarget(null)}
            role="dialog"
            aria-label="Delete folder confirmation"
          >
            <div
              className="rounded-lg shadow-xl p-5 max-w-sm w-full mx-4 flex flex-col gap-4"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-bg)',
                color: 'var(--color-text)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <h3 className="text-sm font-semibold mb-1">
                  Delete folder &ldquo;{deleteTarget.name}&rdquo;?
                </h3>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {convCount > 0
                    ? `This folder contains ${convCount} conversation${convCount !== 1 ? 's' : ''}${childCount > 0 ? ` and ${childCount} subfolder${childCount !== 1 ? 's' : ''}` : ''}.`
                    : childCount > 0
                      ? `This folder contains ${childCount} subfolder${childCount !== 1 ? 's' : ''}.`
                      : 'This folder is empty.'}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                {convCount > 0 && (
                  <button
                    onClick={() => {
                      deleteFolder(deleteTarget.id, 'delete')
                      setDeleteTarget(null)
                    }}
                    className="w-full px-3 py-2 rounded text-sm font-medium text-left transition-opacity hover:opacity-90 bg-error text-contrast"
                    aria-label="Delete folder and all conversations"
                  >
                    Delete folder and {convCount} conversation{convCount !== 1 ? 's' : ''}
                  </button>
                )}
                <button
                  onClick={() => {
                    deleteFolder(deleteTarget.id)
                    setDeleteTarget(null)
                  }}
                  className="w-full px-3 py-2 rounded text-sm font-medium text-left transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                  }}
                  aria-label="Delete folder and keep conversations"
                >
                  {convCount > 0 ? 'Keep conversations and delete folder only' : 'Delete folder'}
                </button>
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="w-full px-3 py-2 rounded text-sm font-medium text-left transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--color-text-muted)',
                    border: '1px solid var(--color-text-muted)',
                  }}
                  aria-label="Cancel"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
