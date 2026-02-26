import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import type { Folder } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useMobileMode } from '../../hooks/useMobileMode'
import { ConversationItem } from './ConversationItem'
import { EmptyState } from './EmptyState'
import { FolderSettingsPopover } from '../settings/FolderSettingsPopover'
import type { McpServerName } from '../settings/FolderSettingsPopover'
import { useMcpStore } from '../../stores/mcpStore'
import { ContextMenu, ContextMenuItem, ContextMenuDivider } from '../shared/ContextMenu'

const FOLDER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
]

function hsvToHex(h: number, s: number, v: number): string {
  const s1 = s / 100, v1 = v / 100
  const c = v1 * s1
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v1 - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

export function SidebarTree() {
  const isMobile = useMobileMode()
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
    moveSelectedToFolder,
    createConversation,
    selectedIds,
    clearSelection,
  } = useConversationsStore()

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menuFolderId, setMenuFolderId] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null)
  const [overrideFolderId, setOverrideFolderId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null)
  const [colorPickerTarget, setColorPickerTarget] = useState<number | null>(null)
  const [colorPickerLive, setColorPickerLive] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pickerHsv, setPickerHsv] = useState({ h: 210, s: 100, v: 100 })
  const [colorPickerPos, setColorPickerPos] = useState({ x: 200, y: 200 })
  const hsvRef = useRef({ h: 210, s: 100, v: 100 })
  const hexInputRef = useRef<HTMLInputElement>(null)

  const handleSVMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const update = (ev: { clientX: number; clientY: number }) => {
      const s = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100))
      const v = Math.max(0, Math.min(100, (1 - (ev.clientY - rect.top) / rect.height) * 100))
      setPickerHsv(prev => ({ ...prev, s, v }))
    }
    update(e)
    const onMove = (ev: MouseEvent) => update(ev)
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const handleHueMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const update = (ev: { clientX: number }) => {
      const h = Math.max(0, Math.min(360, ((ev.clientX - rect.left) / rect.width) * 360))
      setPickerHsv(prev => ({ ...prev, h }))
    }
    update(e)
    const onMove = (ev: MouseEvent) => update(ev)
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const openFolderMenuAt = useCallback((folderId: number, x: number, y: number) => {
    setMenuPos({ x, y })
    setMenuFolderId(folderId)
  }, [])

  const handleFolderThreeDotClick = useCallback((e: React.MouseEvent, folderId: number) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    openFolderMenuAt(folderId, rect.left, rect.bottom + 4)
  }, [openFolderMenuAt])

  const handleFolderTouchStart = useCallback((e: React.TouchEvent, folderId: number) => {
    if (!isMobile) return
    const touch = e.touches[0]
    const x = touch.clientX
    const y = touch.clientY
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      openFolderMenuAt(folderId, x, y)
    }, 500)
  }, [isMobile, openFolderMenuAt])

  const handleFolderTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handleFolderTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

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

  // Sync custom color picker live preview
  useEffect(() => {
    if (colorPickerTarget === null) return
    const hex = hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v)
    setColorPickerLive(hex)
    hsvRef.current = pickerHsv
    if (hexInputRef.current && document.activeElement !== hexInputRef.current) {
      hexInputRef.current.value = hex
    }
  }, [pickerHsv, colorPickerTarget])

  const closeColorPicker = useCallback(() => {
    const { h, s, v } = hsvRef.current
    const color = hsvToHex(h, s, v)
    updateFolder(colorPickerTarget!, { color })
    setColorPickerTarget(null)
    setColorPickerLive(null)
  }, [colorPickerTarget, updateFolder])

  // Compute flat visible order of conversation IDs for shift+click range selection
  const visibleOrder = useMemo(() => {
    const order: number[] = []
    const isSearchMode = searchQuery.trim().length > 0
    const collectFolder = (parentId: number) => {
      const folderConvs = conversations.filter((c) => c.folder_id === parentId)
      for (const c of folderConvs) order.push(c.id)
      const children = folders.filter((f) => f.parent_id === parentId)
      for (const child of children) collectFolder(child.id)
    }
    const rootFolders = folders.filter((f) => f.parent_id === null)
    for (const folder of rootFolders) {
      if (isSearchMode || expandedIds.has(folder.id)) {
        collectFolder(folder.id)
      }
    }
    return order
  }, [conversations, folders, expandedIds, searchQuery])

  // Escape clears selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedIds.size, clearSelection])

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
    const conv = await createConversation(undefined, folderId)
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

  // Heatmap: compute automatic folder colors based on conversation count
  const heatmapColors = useMemo(() => {
    if (globalSettings.heatmap_enabled !== 'true') return null

    const mode = globalSettings.heatmap_mode || 'relative'
    const fixedMin = parseInt(globalSettings.heatmap_min || '0', 10)
    const fixedMax = parseInt(globalSettings.heatmap_max || '50', 10)

    const counts = new Map<number, number>()
    for (const folder of folders) {
      counts.set(folder.id, getRecursiveConversationCount(folder.id))
    }

    let minCount: number, maxCount: number
    if (mode === 'relative') {
      const allCounts = [...counts.values()]
      minCount = allCounts.length > 0 ? Math.min(...allCounts) : 0
      maxCount = allCounts.length > 0 ? Math.max(...allCounts) : 1
      if (maxCount === minCount) maxCount = minCount + 1
    } else {
      minCount = fixedMin
      maxCount = Math.max(fixedMax, fixedMin + 1)
    }

    const colors = new Map<number, string>()
    for (const [folderId, count] of counts) {
      const t = Math.max(0, Math.min(1, (count - minCount) / (maxCount - minCount)))
      colors.set(folderId, hsvToHex(120 * (1 - t), 70, 80))
    }
    return colors
  }, [globalSettings.heatmap_enabled, globalSettings.heatmap_mode, globalSettings.heatmap_min, globalSettings.heatmap_max, folders, conversations])

  const buildTree = (parentId: number | null): Folder[] => {
    return folders.filter((f) => f.parent_id === parentId)
  }

  const handleDrop = (e: React.DragEvent, folderId: number | null) => {
    e.preventDefault()
    setDragOverFolderId(null)
    const raw = e.dataTransfer.getData('text/plain')

    // Try parsing as JSON array (multi-select drag)
    let ids: number[]
    try {
      const parsed = JSON.parse(raw)
      ids = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      const single = parseInt(raw, 10)
      if (isNaN(single)) return
      ids = [single]
    }

    if (ids.length > 1) {
      // Bulk move via store action
      moveSelectedToFolder(folderId)
    } else {
      const conversationId = ids[0]
      const conv = conversations.find((c) => c.id === conversationId)
      if (!conv || conv.folder_id === folderId) return
      moveToFolder(conversationId, folderId)
    }
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

  const renderFolder = (folder: Folder, depth: number) => {
    const isExpanded = isSearching || expandedIds.has(folder.id)
    const children = buildTree(folder.id)
    const count = getConversationCount(folder.id)
    const folderConversations = conversations.filter((c) => c.folder_id === folder.id)
    const isDragOver = dragOverFolderId === folder.id
    const manualColor = (colorPickerTarget === folder.id && colorPickerLive) ? colorPickerLive : folder.color
    const effectiveColor = manualColor || (heatmapColors?.get(folder.id) ?? null)

    return (
      <div key={folder.id}>
        <div
          className={`group flex items-center gap-1 px-2 py-1 mobile:py-2 cursor-pointer rounded mx-1 text-sm${isDragOver ? ' sidebar-drop-active' : ''}${!isDragOver && !effectiveColor ? ' hover:bg-[var(--color-bg)]' : ''}`}
          style={{
            paddingLeft: `${depth * 16 + 8}px`,
            color: 'var(--color-text)',
            ...(effectiveColor ? {
              borderLeft: `3px solid ${effectiveColor}`,
              backgroundColor: `color-mix(in srgb, ${effectiveColor} 15%, transparent)`,
            } : {}),
          }}
          onClick={() => toggleExpand(folder.id)}
          onContextMenu={!isMobile ? (e) => handleContextMenu(e, folder.id) : undefined}
          {...(!isMobile ? {
            onDrop: (e: React.DragEvent) => handleDrop(e, folder.id),
            onDragOver: handleDragOver,
            onDragEnter: (e: React.DragEvent) => handleFolderDragEnter(e, folder.id),
            onDragLeave: handleFolderDragLeave,
          } : {})}
          onTouchStart={(e) => handleFolderTouchStart(e, folder.id)}
          onTouchEnd={handleFolderTouchEnd}
          onTouchMove={handleFolderTouchMove}
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
              className="flex-1 text-sm mobile:text-base px-1 rounded outline-none"
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
                className="opacity-0 group-hover:opacity-100 p-0.5 mobile:opacity-100 mobile:p-2 transition-opacity rounded hover:bg-[var(--color-surface)]"
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
              <button
                onClick={(e) => handleFolderThreeDotClick(e, folder.id)}
                className="hidden mobile:block p-2.5 rounded flex-shrink-0 hover:bg-[var(--color-surface)]"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label="Folder actions"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <circle cx="10" cy="4" r="1.5" />
                  <circle cx="10" cy="10" r="1.5" />
                  <circle cx="10" cy="16" r="1.5" />
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
                isSelected={selectedIds.has(conv.id)}
                visibleOrder={visibleOrder}
                depth={depth + 1}
                folderColor={effectiveColor}
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

  return (
    <div className="flex-1 overflow-y-auto pb-2" role="tree" aria-label="Conversations tree">
      {rootFolders.map((folder) => renderFolder(folder, 0))}

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
        <ContextMenu position={menuPos} onClose={() => setMenuFolderId(null)} className="min-w-[160px]">
          <ContextMenuItem onClick={() => {
            const folder = folders.find((f) => f.id === menuFolderId)
            if (folder) {
              setRenameValue(folder.name)
              setRenamingId(menuFolderId)
            }
            setMenuFolderId(null)
          }}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleCreateSubfolder(menuFolderId!)}>
            Create subfolder
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            setOverrideFolderId(menuFolderId)
            setMenuFolderId(null)
          }}>
            Folder Settings
          </ContextMenuItem>
          <ContextMenuDivider />
          <div className="px-3 py-1.5 mobile:py-2.5">
            <div className="text-xs mb-1.5" style={{ color: 'var(--color-text-muted)' }}>Color</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {FOLDER_COLORS.map((c) => {
                const currentColor = folders.find((f) => f.id === menuFolderId)?.color
                return (
                  <button
                    key={c}
                    onClick={() => {
                      updateFolder(menuFolderId!, { color: c })
                      setMenuFolderId(null)
                    }}
                    className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      outline: currentColor === c ? '2px solid var(--color-text)' : 'none',
                      outlineOffset: '1px',
                    }}
                    aria-label={`Set folder color to ${c}`}
                  />
                )
              })}
              <button
                onClick={() => {
                  const currentColor = folders.find(f => f.id === menuFolderId)?.color || '#3b82f6'
                  setPickerHsv(hexToHsv(currentColor))
                  setColorPickerPos({ x: menuPos.x, y: menuPos.y })
                  setColorPickerTarget(menuFolderId!)
                  setMenuFolderId(null)
                }}
                className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-110 flex items-center justify-center text-xs"
                style={{
                  border: '1px dashed var(--color-text-muted)',
                  color: 'var(--color-text-muted)',
                }}
                title="Custom color"
                aria-label="Pick custom folder color"
              >
                +
              </button>
              {folders.find((f) => f.id === menuFolderId)?.color && (
                <button
                  onClick={() => {
                    updateFolder(menuFolderId!, { color: null })
                    setMenuFolderId(null)
                  }}
                  className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-125 flex items-center justify-center text-xs font-bold"
                  style={{
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-text-muted)',
                  }}
                  title="Remove color"
                  aria-label="Remove folder color"
                >
                  &times;
                </button>
              )}
            </div>
          </div>
          {folders.find(f => f.id === menuFolderId)?.is_default !== 1 && (
            <>
              <ContextMenuDivider />
              <ContextMenuItem danger onClick={() => handleDelete(menuFolderId!)}>
                Delete folder
              </ContextMenuItem>
            </>
          )}
        </ContextMenu>
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
                    className="w-full px-3 py-2 mobile:py-3 rounded text-sm font-medium text-left transition-opacity hover:opacity-90 bg-error text-contrast"
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
                  className="w-full px-3 py-2 mobile:py-3 rounded text-sm font-medium text-left transition-opacity hover:opacity-80"
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
                  className="w-full px-3 py-2 mobile:py-3 rounded text-sm font-medium text-left transition-opacity hover:opacity-80"
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

      {/* Custom HSV color picker — draggable, styled like context menus */}
      {colorPickerTarget !== null && (
        <ContextMenu position={colorPickerPos} onClose={closeColorPicker} style={{ width: 220 }}>
          <div className="px-2.5 pb-2.5">
            {/* Saturation-Value square */}
            <div
              style={{
                width: '100%', height: 140, position: 'relative',
                backgroundColor: `hsl(${pickerHsv.h}, 100%, 50%)`,
                borderRadius: 4, cursor: 'crosshair',
              }}
              onMouseDown={handleSVMouseDown}
            >
              <div style={{ position: 'absolute', inset: 0, borderRadius: 4, background: 'linear-gradient(to right, white, transparent)' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: 4, background: 'linear-gradient(to bottom, transparent, black)' }} />
              <div style={{
                position: 'absolute',
                left: `${pickerHsv.s}%`, top: `${100 - pickerHsv.v}%`,
                width: 12, height: 12, borderRadius: '50%',
                border: '2px solid white', boxShadow: '0 0 2px rgba(0,0,0,0.6)',
                transform: 'translate(-50%, -50%)', pointerEvents: 'none',
              }} />
            </div>
            {/* Hue bar */}
            <div
              style={{
                width: '100%', height: 14, marginTop: 8, position: 'relative',
                background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
                borderRadius: 4, cursor: 'crosshair',
              }}
              onMouseDown={handleHueMouseDown}
            >
              <div style={{
                position: 'absolute',
                left: `${(pickerHsv.h / 360) * 100}%`, top: '50%',
                width: 8, height: 14, borderRadius: 3,
                border: '2px solid white', boxShadow: '0 0 2px rgba(0,0,0,0.6)',
                transform: 'translate(-50%, -50%)', pointerEvents: 'none',
              }} />
            </div>
            {/* Preview swatch + hex input */}
            <div className="flex items-center gap-2 mt-2">
              <div
                style={{
                  width: 28, height: 28, borderRadius: 4, flexShrink: 0,
                  backgroundColor: hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v),
                  border: '1px solid var(--color-text-muted)',
                }}
              />
              <input
                ref={hexInputRef}
                type="text"
                defaultValue={hsvToHex(pickerHsv.h, pickerHsv.s, pickerHsv.v)}
                className="flex-1 px-2 py-1 rounded text-xs font-mono"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-text-muted)',
                  outline: 'none',
                }}
                onChange={(e) => {
                  const val = e.target.value
                  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                    setPickerHsv(hexToHsv(val))
                  }
                }}
                maxLength={7}
              />
            </div>
          </div>
        </ContextMenu>
      )}
    </div>
  )
}
