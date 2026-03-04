import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import type { Folder, Conversation } from '../../../shared/types'
import { useConversationsStore } from '../../stores/conversationsStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useMobileMode } from '../../hooks/useMobileMode'
import { ConversationItem } from './ConversationItem'
import { EmptyState } from './EmptyState'
import { FolderSettingsPopover } from '../settings/FolderSettingsPopover'
import type { McpServerName } from '../settings/FolderSettingsPopover'
import { useMcpStore } from '../../stores/mcpStore'
import { ContextMenu, ContextMenuItem, ContextMenuDivider } from '../shared/ContextMenu'
import { ColorSwatches, ColorPicker as ColorPickerPanel, hsvToHex } from '../shared/ColorPicker'

// --- FolderRow: memoized extracted component (Task 2.1) ---

interface FolderRowProps {
  folder: Folder
  depth: number
  isExpanded: boolean
  isSearching: boolean
  childFolderIds: number[]
  convCount: number
  folderConversations: Conversation[]
  isDragOver: boolean
  isBeingDragged: boolean
  dropIndicator: 'before' | 'after' | 'inside' | null
  effectiveColor: string | null
  isDraggableFolder: boolean
  isRenaming: boolean
  renameValue: string
  activeConversationId: number | null
  selectedIds: Set<number>
  visibleOrder: number[]
  colorPickerTarget: number | null
  colorPickerLive: string | null
  // Handlers (stable via useCallback in parent)
  onToggleExpand: (id: number) => void
  onContextMenu: (e: React.MouseEvent, folderId: number) => void
  onFolderDropOnFolder: (e: React.DragEvent, folder: Folder) => void
  onDrop: (e: React.DragEvent, folderId: number | null) => void
  onFolderDragOver: (e: React.DragEvent, folder: Folder) => void
  onDragOver: (e: React.DragEvent) => void
  onFolderDragEnter: (e: React.DragEvent, folderId: number) => void
  onDragLeave: (e: React.DragEvent) => void
  onFolderDragStart: (e: React.DragEvent, folderId: number) => void
  onFolderDragEnd: () => void
  onFolderTouchStart: (e: React.TouchEvent, folderId: number) => void
  onFolderTouchEnd: () => void
  onFolderTouchMove: () => void
  onFolderThreeDotClick: (e: React.MouseEvent, folderId: number) => void
  onNewConversationInFolder: (folderId: number, e: React.MouseEvent) => void
  onRenameChange: (value: string) => void
  onRenameSubmit: (folderId: number) => void
  onRenamingCancel: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
  isMobile: boolean
  // For recursive rendering
  childrenByParent: Map<number | null, Folder[]>
  convsByFolder: Map<number, Conversation[]>
  convCountByFolder: Map<number, number>
  heatmapColors: Map<number, string> | null
  draggingFolderId: number | null
  folderDropIndicator: { targetId: number; position: 'before' | 'after' | 'inside' } | null
  dragOverFolderId: number | null
  expandedIds: Set<number>
  renamingId: number | null
}

const FolderRow = memo(function FolderRow(props: FolderRowProps) {
  const {
    folder, depth, isExpanded, isSearching, childFolderIds, convCount,
    folderConversations, isDragOver, isBeingDragged, dropIndicator,
    effectiveColor, isDraggableFolder, isRenaming, renameValue,
    activeConversationId, selectedIds, visibleOrder,
    onToggleExpand, onContextMenu, onFolderDropOnFolder, onDrop,
    onFolderDragOver, onDragOver, onFolderDragEnter, onDragLeave,
    onFolderDragStart, onFolderDragEnd, onFolderTouchStart, onFolderTouchEnd,
    onFolderTouchMove, onFolderThreeDotClick, onNewConversationInFolder,
    onRenameChange, onRenameSubmit, onRenamingCancel, inputRef, isMobile,
    // Recursive rendering data
    childrenByParent, convsByFolder, convCountByFolder, heatmapColors,
    draggingFolderId, folderDropIndicator: parentFolderDropIndicator,
    dragOverFolderId, expandedIds, renamingId, colorPickerTarget, colorPickerLive,
  } = props

  const dropClass = dropIndicator === 'before' ? ' folder-drop-before'
    : dropIndicator === 'after' ? ' folder-drop-after'
    : dropIndicator === 'inside' ? ' sidebar-drop-active'
    : ''

  const children = childFolderIds.length > 0
    ? (childrenByParent.get(folder.id) ?? [])
    : []

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1 mobile:py-2 cursor-pointer rounded mx-1 text-sm${isDragOver ? ' sidebar-drop-active' : ''}${dropClass}${isBeingDragged ? ' sidebar-dragging' : ''}${!isDragOver && !dropIndicator && !effectiveColor ? ' hover:bg-[var(--color-bg)]' : ''}`}
        style={{
          paddingLeft: `${depth * 16 + (isDraggableFolder ? 0 : 8)}px`,
          color: 'var(--color-text)',
          ...(effectiveColor && !dropClass ? {
            borderLeft: `3px solid ${effectiveColor}`,
            backgroundColor: `color-mix(in srgb, ${effectiveColor} 15%, transparent)`,
          } : {}),
        }}
        onClick={() => onToggleExpand(folder.id)}
        onContextMenu={!isMobile ? (e) => onContextMenu(e, folder.id) : undefined}
        {...(!isMobile ? {
          onDrop: (e: React.DragEvent) => {
            if (e.dataTransfer.types.includes('application/x-folder-id')) {
              onFolderDropOnFolder(e, folder)
            } else {
              onDrop(e, folder.id)
            }
          },
          onDragOver: (e: React.DragEvent) => {
            if (e.dataTransfer.types.includes('application/x-folder-id')) {
              onFolderDragOver(e, folder)
            } else {
              onDragOver(e)
            }
          },
          onDragEnter: (e: React.DragEvent) => onFolderDragEnter(e, folder.id),
          onDragLeave: (e: React.DragEvent) => onDragLeave(e),
        } : {})}
        onTouchStart={(e) => onFolderTouchStart(e, folder.id)}
        onTouchEnd={onFolderTouchEnd}
        onTouchMove={onFolderTouchMove}
        role="treeitem"
        aria-expanded={isExpanded}
        aria-label={`Folder: ${folder.name}`}
      >
        {/* Drag grip handle -- non-default folders only, desktop only */}
        {isDraggableFolder && (
          <span
            className="opacity-0 group-hover:opacity-100 transition-opacity cursor-grab flex-shrink-0"
            style={{ color: 'var(--color-text-muted)' }}
            draggable
            onDragStart={(e) => onFolderDragStart(e, folder.id)}
            onDragEnd={onFolderDragEnd}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Drag folder ${folder.name}`}
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="3" cy="2" r="1.2" />
              <circle cx="7" cy="2" r="1.2" />
              <circle cx="3" cy="7" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="3" cy="12" r="1.2" />
              <circle cx="7" cy="12" r="1.2" />
            </svg>
          </span>
        )}
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {childFolderIds.length > 0 || convCount > 0 ? (isExpanded ? '\u25BE' : '\u25B8') : '\u2022'}
        </span>
        {isRenaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={() => onRenameSubmit(folder.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit(folder.id)
              if (e.key === 'Escape') onRenamingCancel()
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
            {convCount > 0 && (
              <span
                className="text-xs px-1.5 rounded-full"
                style={{
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {convCount}
              </span>
            )}
            <button
              className="opacity-0 group-hover:opacity-100 p-0.5 mobile:opacity-100 mobile:p-2 transition-opacity rounded hover:bg-[var(--color-surface)]"
              onClick={(e) => onNewConversationInFolder(folder.id, e)}
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
              onClick={(e) => onFolderThreeDotClick(e, folder.id)}
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
          {children.map((child) => {
            const childIsExpanded = isSearching || expandedIds.has(child.id)
            const childChildren = childrenByParent.get(child.id) ?? []
            const childConvCount = convCountByFolder.get(child.id) ?? 0
            const childConvs = convsByFolder.get(child.id) ?? []
            const childIsDragOver = dragOverFolderId === child.id
            const childIsBeingDragged = draggingFolderId === child.id
            const childDropIndicator = parentFolderDropIndicator?.targetId === child.id ? parentFolderDropIndicator.position : null
            const childManualColor = (colorPickerTarget === child.id && colorPickerLive) ? colorPickerLive : child.color
            const childEffectiveColor = childManualColor || (heatmapColors?.get(child.id) ?? null)
            const childIsRenaming = renamingId === child.id
            return (
              <FolderRow
                key={child.id}
                folder={child}
                depth={depth + 1}
                isExpanded={childIsExpanded}
                isSearching={isSearching}
                childFolderIds={childChildren.map(f => f.id)}
                convCount={childConvCount}
                folderConversations={childConvs}
                isDragOver={childIsDragOver}
                isBeingDragged={childIsBeingDragged}
                dropIndicator={childDropIndicator}
                effectiveColor={childEffectiveColor}
                isDraggableFolder={isDraggableFolder}
                isRenaming={childIsRenaming}
                renameValue={childIsRenaming ? renameValue : ''}
                activeConversationId={activeConversationId}
                selectedIds={selectedIds}
                visibleOrder={visibleOrder}
                colorPickerTarget={colorPickerTarget}
                colorPickerLive={colorPickerLive}
                onToggleExpand={onToggleExpand}
                onContextMenu={onContextMenu}
                onFolderDropOnFolder={onFolderDropOnFolder}
                onDrop={onDrop}
                onFolderDragOver={onFolderDragOver}
                onDragOver={onDragOver}
                onFolderDragEnter={onFolderDragEnter}
                onDragLeave={onDragLeave}
                onFolderDragStart={onFolderDragStart}
                onFolderDragEnd={onFolderDragEnd}
                onFolderTouchStart={onFolderTouchStart}
                onFolderTouchEnd={onFolderTouchEnd}
                onFolderTouchMove={onFolderTouchMove}
                onFolderThreeDotClick={onFolderThreeDotClick}
                onNewConversationInFolder={onNewConversationInFolder}
                onRenameChange={onRenameChange}
                onRenameSubmit={onRenameSubmit}
                onRenamingCancel={onRenamingCancel}
                inputRef={inputRef}
                isMobile={isMobile}
                childrenByParent={childrenByParent}
                convsByFolder={convsByFolder}
                convCountByFolder={convCountByFolder}
                heatmapColors={heatmapColors}
                draggingFolderId={draggingFolderId}
                folderDropIndicator={parentFolderDropIndicator}
                dragOverFolderId={dragOverFolderId}
                expandedIds={expandedIds}
                renamingId={renamingId}
              />
            )
          })}
        </>
      )}
    </div>
  )
})

// --- SidebarTree: main component ---

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
    reorderFolders,
    selectedIds,
    clearSelection,
  } = useConversationsStore()

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menuFolderId, setMenuFolderId] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null)
  const [draggingFolderId, setDraggingFolderId] = useState<number | null>(null)
  const [folderDropIndicator, setFolderDropIndicator] = useState<{
    targetId: number
    position: 'before' | 'after' | 'inside'
  } | null>(null)
  const [overrideFolderId, setOverrideFolderId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null)
  const [colorPickerTarget, setColorPickerTarget] = useState<number | null>(null)
  const [colorPickerLive, setColorPickerLive] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [colorPickerPos, setColorPickerPos] = useState({ x: 200, y: 200 })

  // --- Task 2.4: Pre-build index maps for O(1) lookups ---
  const childrenByParent = useMemo(() => {
    const map = new Map<number | null, Folder[]>()
    for (const f of folders) {
      const pid = f.parent_id ?? null
      const arr = map.get(pid)
      if (arr) arr.push(f)
      else map.set(pid, [f])
    }
    return map
  }, [folders])

  const convCountByFolder = useMemo(() => {
    const map = new Map<number, number>()
    for (const c of conversations) {
      const fid = c.folder_id
      if (fid !== null) {
        map.set(fid, (map.get(fid) || 0) + 1)
      }
    }
    return map
  }, [conversations])

  const convsByFolder = useMemo(() => {
    const map = new Map<number, Conversation[]>()
    for (const c of conversations) {
      const fid = c.folder_id
      if (fid !== null) {
        const arr = map.get(fid)
        if (arr) arr.push(c)
        else map.set(fid, [c])
      }
    }
    return map
  }, [conversations])

  const foldersById = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders])

  // Recursive conversation count using index maps (replaces O(N^2) scans)
  const recursiveConvCounts = useMemo(() => {
    const result = new Map<number, number>()
    const compute = (folderId: number): number => {
      if (result.has(folderId)) return result.get(folderId)!
      const direct = convCountByFolder.get(folderId) || 0
      const children = childrenByParent.get(folderId) ?? []
      const total = direct + children.reduce((sum, f) => sum + compute(f.id), 0)
      result.set(folderId, total)
      return total
    }
    for (const f of folders) compute(f.id)
    return result
  }, [folders, convCountByFolder, childrenByParent])

  // Recursive child folder count using index maps
  const recursiveChildFolderCounts = useMemo(() => {
    const result = new Map<number, number>()
    const compute = (folderId: number): number => {
      if (result.has(folderId)) return result.get(folderId)!
      const children = childrenByParent.get(folderId) ?? []
      const total = children.length + children.reduce((sum, f) => sum + compute(f.id), 0)
      result.set(folderId, total)
      return total
    }
    for (const f of folders) compute(f.id)
    return result
  }, [folders, childrenByParent])

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

  const handleColorPickerChange = useCallback((color: string | null) => {
    if (colorPickerTarget === null) return
    if (color) {
      setColorPickerLive(color)
      updateFolder(colorPickerTarget, { color })
    }
    setColorPickerTarget(null)
    setColorPickerLive(null)
  }, [colorPickerTarget, updateFolder])

  // Compute flat visible order using index maps
  const visibleOrder = useMemo(() => {
    const order: number[] = []
    const isSearchMode = searchQuery.trim().length > 0
    const collectFolder = (parentId: number) => {
      const folderConvs = convsByFolder.get(parentId) ?? []
      for (const c of folderConvs) order.push(c.id)
      const children = childrenByParent.get(parentId) ?? []
      for (const child of children) collectFolder(child.id)
    }
    const rootFolders = childrenByParent.get(null) ?? []
    for (const folder of rootFolders) {
      if (isSearchMode || expandedIds.has(folder.id)) {
        collectFolder(folder.id)
      }
    }
    return order
  }, [convsByFolder, childrenByParent, expandedIds, searchQuery])

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

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, folderId: number) => {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuFolderId(folderId)
  }, [])

  const handleRenameSubmit = useCallback((folderId: number) => {
    const trimmed = renameValue.trim()
    if (trimmed) {
      updateFolder(folderId, { name: trimmed })
    }
    setRenamingId(null)
  }, [renameValue, updateFolder])

  const handleDelete = useCallback((folderId: number) => {
    setMenuFolderId(null)
    const folder = foldersById.get(folderId)
    if (folder) {
      setDeleteTarget({ id: folder.id, name: folder.name })
    }
  }, [foldersById])

  const handleCreateSubfolder = useCallback((parentId: number) => {
    setMenuFolderId(null)
    createFolder('New Folder', parentId)
  }, [createFolder])

  const handleNewConversationInFolder = useCallback(async (folderId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const conv = await createConversation(undefined, folderId)
    setExpandedIds((prev) => new Set(prev).add(folderId))
  }, [createConversation])

  const handleRenameChange = useCallback((value: string) => {
    setRenameValue(value)
  }, [])

  const handleRenamingCancel = useCallback(() => {
    setRenamingId(null)
  }, [])

  // Heatmap: compute automatic folder colors based on conversation count using index maps
  const heatmapColors = useMemo(() => {
    if (globalSettings.heatmap_enabled !== 'true') return null

    const mode = globalSettings.heatmap_mode || 'relative'
    const fixedMin = parseInt(globalSettings.heatmap_min || '0', 10)
    const fixedMax = parseInt(globalSettings.heatmap_max || '50', 10)

    let minCount: number, maxCount: number
    if (mode === 'relative') {
      const allCounts = [...recursiveConvCounts.values()]
      minCount = allCounts.length > 0 ? Math.min(...allCounts) : 0
      maxCount = allCounts.length > 0 ? Math.max(...allCounts) : 1
      if (maxCount === minCount) maxCount = minCount + 1
    } else {
      minCount = fixedMin
      maxCount = Math.max(fixedMax, fixedMin + 1)
    }

    const colors = new Map<number, string>()
    for (const [folderId, count] of recursiveConvCounts) {
      const t = Math.max(0, Math.min(1, (count - minCount) / (maxCount - minCount)))
      colors.set(folderId, hsvToHex(120 * (1 - t), 70, 80))
    }
    return colors
  }, [globalSettings.heatmap_enabled, globalSettings.heatmap_mode, globalSettings.heatmap_min, globalSettings.heatmap_max, recursiveConvCounts])

  const isDescendant = useCallback((folderId: number, ancestorId: number): boolean => {
    let current = foldersById.get(folderId)
    while (current) {
      if (current.parent_id === ancestorId) return true
      current = current.parent_id !== null ? foldersById.get(current.parent_id) : undefined
    }
    return false
  }, [foldersById])

  const handleFolderDragStart = useCallback((e: React.DragEvent, folderId: number) => {
    e.stopPropagation()
    setDraggingFolderId(folderId)
    e.dataTransfer.setData('application/x-folder-id', String(folderId))
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleFolderDragEnd = useCallback(() => {
    setDraggingFolderId(null)
    setFolderDropIndicator(null)
  }, [])

  const handleFolderDragOver = useCallback((e: React.DragEvent, targetFolder: Folder) => {
    if (!e.dataTransfer.types.includes('application/x-folder-id')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'

    if (draggingFolderId === null || draggingFolderId === targetFolder.id) return
    if (isDescendant(targetFolder.id, draggingFolderId)) return

    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    let position: 'before' | 'after' | 'inside'
    if (y < 0.25) position = 'before'
    else if (y > 0.75) position = 'after'
    else position = 'inside'

    setFolderDropIndicator({ targetId: targetFolder.id, position })
  }, [draggingFolderId, isDescendant])

  const handleFolderDropOnFolder = useCallback(async (e: React.DragEvent, targetFolder: Folder) => {
    const raw = e.dataTransfer.getData('application/x-folder-id')
    if (!raw) return
    e.preventDefault()
    e.stopPropagation()

    const draggedId = parseInt(raw, 10)
    if (isNaN(draggedId) || draggedId === targetFolder.id) return
    if (isDescendant(targetFolder.id, draggedId)) return

    const indicator = folderDropIndicator
    setDraggingFolderId(null)
    setFolderDropIndicator(null)
    if (!indicator || indicator.targetId !== targetFolder.id) return

    if (indicator.position === 'inside') {
      await updateFolder(draggedId, { parent_id: targetFolder.id })
    } else {
      // Reorder: move to same parent as target, insert before/after
      const newParentId = targetFolder.parent_id
      const draggedFolder = foldersById.get(draggedId)
      // Update parent if needed
      if (draggedFolder && draggedFolder.parent_id !== newParentId) {
        await updateFolder(draggedId, { parent_id: newParentId })
      }
      // Compute new sibling order using index map
      const siblings = (childrenByParent.get(newParentId) ?? [])
        .filter((f) => f.id !== draggedId)
        .sort((a, b) => a.position - b.position)
      const targetIndex = siblings.findIndex((f) => f.id === targetFolder.id)
      const insertIndex = indicator.position === 'before' ? targetIndex : targetIndex + 1
      const newOrder = [...siblings]
      newOrder.splice(insertIndex, 0, { id: draggedId } as Folder)
      await reorderFolders(newOrder.map((f) => f.id))
    }
  }, [folderDropIndicator, foldersById, childrenByParent, isDescendant, updateFolder, reorderFolders])

  const handleDrop = useCallback((e: React.DragEvent, folderId: number | null) => {
    e.preventDefault()
    setDragOverFolderId(null)
    // Ignore folder drags -- those are handled by handleFolderDropOnFolder
    if (e.dataTransfer.types.includes('application/x-folder-id')) return
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
  }, [conversations, moveToFolder, moveSelectedToFolder])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleFolderDragEnter = useCallback((e: React.DragEvent, folderId: number) => {
    e.preventDefault()
    // Only highlight for conversation drags, not folder drags
    if (!e.dataTransfer.types.includes('application/x-folder-id')) {
      setDragOverFolderId(folderId)
    }
  }, [])

  const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverFolderId(null)
      setFolderDropIndicator(null)
    }
  }, [])

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

  const rootFolders = childrenByParent.get(null) ?? []

  return (
    <div className="flex-1 overflow-y-auto pb-2" role="tree" aria-label="Conversations tree">
      {rootFolders.map((folder) => {
        const isExpanded = isSearching || expandedIds.has(folder.id)
        const children = childrenByParent.get(folder.id) ?? []
        const convCount = convCountByFolder.get(folder.id) ?? 0
        const folderConvs = convsByFolder.get(folder.id) ?? []
        const isDragOver = dragOverFolderId === folder.id
        const isBeingDragged = draggingFolderId === folder.id
        const dropIndicator = folderDropIndicator?.targetId === folder.id ? folderDropIndicator.position : null
        const manualColor = (colorPickerTarget === folder.id && colorPickerLive) ? colorPickerLive : folder.color
        const effectiveColor = manualColor || (heatmapColors?.get(folder.id) ?? null)
        const folderIsRenaming = renamingId === folder.id
        return (
          <FolderRow
            key={folder.id}
            folder={folder}
            depth={0}
            isExpanded={isExpanded}
            isSearching={isSearching}
            childFolderIds={children.map(f => f.id)}
            convCount={convCount}
            folderConversations={folderConvs}
            isDragOver={isDragOver}
            isBeingDragged={isBeingDragged}
            dropIndicator={dropIndicator}
            effectiveColor={effectiveColor}
            isDraggableFolder={!isMobile}
            isRenaming={folderIsRenaming}
            renameValue={folderIsRenaming ? renameValue : ''}
            activeConversationId={activeConversationId}
            selectedIds={selectedIds}
            visibleOrder={visibleOrder}
            colorPickerTarget={colorPickerTarget}
            colorPickerLive={colorPickerLive}
            onToggleExpand={toggleExpand}
            onContextMenu={handleContextMenu}
            onFolderDropOnFolder={handleFolderDropOnFolder}
            onDrop={handleDrop}
            onFolderDragOver={handleFolderDragOver}
            onDragOver={handleDragOver}
            onFolderDragEnter={handleFolderDragEnter}
            onDragLeave={handleFolderDragLeave}
            onFolderDragStart={handleFolderDragStart}
            onFolderDragEnd={handleFolderDragEnd}
            onFolderTouchStart={handleFolderTouchStart}
            onFolderTouchEnd={handleFolderTouchEnd}
            onFolderTouchMove={handleFolderTouchMove}
            onFolderThreeDotClick={handleFolderThreeDotClick}
            onNewConversationInFolder={handleNewConversationInFolder}
            onRenameChange={handleRenameChange}
            onRenameSubmit={handleRenameSubmit}
            onRenamingCancel={handleRenamingCancel}
            inputRef={inputRef}
            isMobile={isMobile}
            childrenByParent={childrenByParent}
            convsByFolder={convsByFolder}
            convCountByFolder={convCountByFolder}
            heatmapColors={heatmapColors}
            draggingFolderId={draggingFolderId}
            folderDropIndicator={folderDropIndicator}
            dragOverFolderId={dragOverFolderId}
            expandedIds={expandedIds}
            renamingId={renamingId}
          />
        )
      })}

      {overrideFolderId !== null && (() => {
        const targetFolder = foldersById.get(overrideFolderId)
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
            const folder = foldersById.get(menuFolderId)
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
          <ColorSwatches
            currentColor={foldersById.get(menuFolderId)?.color ?? null}
            onColorChange={(color) => {
              updateFolder(menuFolderId!, { color })
              setMenuFolderId(null)
            }}
            onOpenPicker={() => {
              setColorPickerPos({ x: menuPos.x, y: menuPos.y })
              setColorPickerTarget(menuFolderId!)
              setMenuFolderId(null)
            }}
          />
          {foldersById.get(menuFolderId)?.is_default !== 1 && (
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
        const convCount = recursiveConvCounts.get(deleteTarget.id) ?? 0
        const childCount = recursiveChildFolderCounts.get(deleteTarget.id) ?? 0
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

      {/* Custom HSV color picker -- draggable, styled like context menus */}
      {colorPickerTarget !== null && (
        <ColorPickerPanel
          currentColor={foldersById.get(colorPickerTarget)?.color ?? null}
          onColorChange={handleColorPickerChange}
          onClose={() => {
            setColorPickerTarget(null)
            setColorPickerLive(null)
          }}
          position={colorPickerPos}
        />
      )}
    </div>
  )
}
