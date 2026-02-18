import { useState, useEffect, useRef, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { useFileExplorerStore } from '../../stores/fileExplorerStore'
import { HtmlPreview } from '../artifacts/HtmlPreview'
import { MarkdownArtifact } from '../artifacts/MarkdownArtifact'
import { MermaidBlock } from '../artifacts/MermaidBlock'
import { SvgPreview } from '../artifacts/SvgPreview'
import { CodeEditorModal } from './CodeEditorModal'
import { PreviewModal } from './PreviewModal'
import type { FileNode } from '../../../shared/types'
import { useSettingsStore } from '../../stores/settingsStore'

function getFileExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return ''
  return filePath.slice(dot + 1).toLowerCase()
}

function getBasename(filePath: string): string {
  const idx = filePath.lastIndexOf('/')
  return idx === -1 ? filePath : filePath.slice(idx + 1)
}

const PREVIEW_EXTENSIONS = new Set(['md', 'markdown', 'html', 'htm', 'svg', 'mmd'])

function isThemesDirectory(cwd: string | null): boolean {
  if (!cwd) return false
  return cwd.replace(/\/+$/, '').endsWith('.agent-desktop/themes')
}

function toMonacoLanguage(lang: string | null): string {
  if (!lang) return 'plaintext'
  const map: Record<string, string> = { bash: 'shell', svg: 'xml' }
  return map[lang] || lang
}

function hasPreviewMode(language: string | null, filePath: string): boolean {
  if (language === 'image') return false
  const ext = getFileExtension(filePath)
  return PREVIEW_EXTENSIONS.has(ext)
}

// ── Rename Input ──────────────────────────────────────────────

function RenameInput({ initialName, onSubmit, onCancel }: {
  initialName: string
  onSubmit: (newName: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialName)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Select name without extension for files, full name for dirs
    const dot = initialName.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : initialName.length)
  }, [initialName])

  const submit = () => {
    if (doneRef.current) return
    doneRef.current = true
    const trimmed = value.trim()
    if (trimmed && trimmed !== initialName) {
      onSubmit(trimmed)
    } else {
      onCancel()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      doneRef.current = true
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={submit}
      onClick={(e) => e.stopPropagation()}
      className="text-sm rounded px-1 outline-none flex-1 min-w-0 bg-deep text-body border border-primary"
      aria-label="Rename file"
    />
  )
}

// ── Context Menu ──────────────────────────────────────────────

interface ContextMenuProps {
  x: number
  y: number
  node: FileNode
  onClose: () => void
  onRename: () => void
  onCreateFile?: (dirPath: string) => void
  onCreateFolder?: (dirPath: string) => void
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm hover:opacity-80 transition-opacity ${danger ? 'text-error' : 'text-body'}`}
    >
      {label}
    </button>
  )
}

function MenuSeparator() {
  return <div className="my-1 mx-2 border-t border-base" />
}

function FileContextMenu({ x, y, node, onClose, onRename, onCreateFile, onCreateFolder }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // Clamp position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 200)
  const adjustedY = Math.min(y, window.innerHeight - 280)

  const handleReveal = async () => {
    try { await window.agent.files.revealInFileManager(node.path) } catch { /* ignore */ }
    onClose()
  }

  const handleOpen = async () => {
    try { await window.agent.files.openWithDefault(node.path) } catch { /* ignore */ }
    onClose()
  }

  const handleCopyPath = async () => {
    try { await navigator.clipboard.writeText(node.path) } catch { /* ignore */ }
    onClose()
  }

  const handleDuplicate = async () => {
    try {
      await window.agent.files.duplicate(node.path)
      useFileExplorerStore.getState().refresh()
    } catch { /* ignore */ }
    onClose()
  }

  const handleTrash = async () => {
    try {
      await window.agent.files.trash(node.path)
      useFileExplorerStore.getState().refresh()
    } catch { /* ignore */ }
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 py-1 rounded-md shadow-lg min-w-[180px] bg-surface border border-base"
      style={{
        left: adjustedX,
        top: adjustedY,
      }}
      role="menu"
      aria-label="File context menu"
    >
      {!node.isDirectory && (
        <MenuItem label="Open with Default App" onClick={handleOpen} />
      )}
      <MenuItem
        label={node.isDirectory ? 'Open in File Manager' : 'Reveal in File Manager'}
        onClick={handleReveal}
      />
      {node.isDirectory && onCreateFile && onCreateFolder && (
        <>
          <MenuSeparator />
          <MenuItem label="New File Here" onClick={() => { onCreateFile(node.path); onClose() }} />
          <MenuItem label="New Folder Here" onClick={() => { onCreateFolder(node.path); onClose() }} />
        </>
      )}
      <MenuSeparator />
      <MenuItem label="Copy Path" onClick={handleCopyPath} />
      <MenuItem label="Rename" onClick={() => { onRename(); onClose() }} />
      <MenuItem label="Duplicate" onClick={handleDuplicate} />
      <MenuSeparator />
      <MenuItem label="Move to Trash" onClick={handleTrash} danger />
    </div>
  )
}

// ── Apply Theme Button ───────────────────────────────────────

function ApplyThemeButton({ filename }: { filename: string }) {
  const activeTheme = useSettingsStore((s) => s.activeTheme)
  const isActive = activeTheme === filename

  const handleApply = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const theme = await window.agent.themes.read(filename)
      useSettingsStore.getState().applyTheme(theme)
    } catch { /* invalid theme file */ }
  }

  if (isActive) {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 bg-primary text-contrast"
        aria-label="Active theme"
      >
        Active
      </span>
    )
  }

  return (
    <button
      onClick={handleApply}
      className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 hover:opacity-80 transition-opacity bg-accent text-contrast"
      title={`Apply ${filename} as theme`}
      aria-label={`Apply ${filename} as theme`}
    >
      Apply
    </button>
  )
}

// ── File Tree Node ────────────────────────────────────────────

function getDirname(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx <= 0 ? '/' : p.slice(0, idx)
}

interface FileTreeNodeProps {
  node: FileNode
  depth: number
  selectedFilePath: string | null
  expandedPaths: Set<string>
  onToggleDir: (dirPath: string) => void
  onExpandDir: (dirPath: string) => void
  onSelect: (path: string) => void
  onContextMenu: (e: React.MouseEvent, node: FileNode) => void
  renamingPath: string | null
  onRenameSubmit: (oldPath: string, newName: string) => void
  onRenameCancel: () => void
  isThemesCwd: boolean
  onDragStart: (path: string) => void
  onDragEnd: () => void
  draggedPath: string | null
  dropTargetPath: string | null
  onDropOnFolder: (folderPath: string) => void
  onDragOverFolder: (folderPath: string) => void
  onDragLeaveFolder: () => void
}

function FileTreeNode({
  node, depth, selectedFilePath, expandedPaths, onToggleDir, onExpandDir, onSelect,
  onContextMenu, renamingPath, onRenameSubmit, onRenameCancel, isThemesCwd,
  onDragStart, onDragEnd, draggedPath, dropTargetPath, onDropOnFolder, onDragOverFolder, onDragLeaveFolder,
}: FileTreeNodeProps) {
  const expanded = node.isDirectory && expandedPaths.has(node.path)
  const autoExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isRenaming = node.path === renamingPath

  const handleCtxMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, node)
  }

  const handleDragStartNode = (e: React.DragEvent) => {
    if (isRenaming) { e.preventDefault(); return }
    e.dataTransfer.setData('text/plain', node.path)
    e.dataTransfer.effectAllowed = 'move'
    e.currentTarget.classList.add('explorer-dragging')
    onDragStart(node.path)
  }

  const handleDragEndNode = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('explorer-dragging')
    onDragEnd()
  }

  // Cleanup auto-expand timer on unmount
  useEffect(() => {
    return () => { if (autoExpandTimer.current) clearTimeout(autoExpandTimer.current) }
  }, [])

  if (node.isDirectory) {
    const isDropTarget = dropTargetPath === node.path

    const handleFolderDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      onDragOverFolder(node.path)
    }

    const handleFolderDragEnter = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDragOverFolder(node.path)
      // Auto-expand collapsed folder after 500ms hover
      if (!expanded) {
        autoExpandTimer.current = setTimeout(() => onExpandDir(node.path), 500)
      }
    }

    const handleFolderDragLeave = (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        onDragLeaveFolder()
      }
      if (autoExpandTimer.current) { clearTimeout(autoExpandTimer.current); autoExpandTimer.current = null }
    }

    const handleFolderDrop = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (autoExpandTimer.current) { clearTimeout(autoExpandTimer.current); autoExpandTimer.current = null }
      const sourcePath = e.dataTransfer.getData('text/plain')
      if (!sourcePath) return
      // Guard: no drop on self, own parent, or own children
      if (sourcePath === node.path) return
      if (getDirname(sourcePath) === node.path) return
      if (node.path.startsWith(sourcePath + '/')) return
      onDropOnFolder(node.path)
    }

    return (
      <div>
        <div
          className={`flex items-center${isDropTarget ? ' explorer-drop-active' : ''}`}
          draggable={!isRenaming}
          onDragStart={handleDragStartNode}
          onDragEnd={handleDragEndNode}
          onDragOver={handleFolderDragOver}
          onDragEnter={handleFolderDragEnter}
          onDragLeave={handleFolderDragLeave}
          onDrop={handleFolderDrop}
        >
          <button
            onClick={() => !isRenaming && onToggleDir(node.path)}
            onContextMenu={handleCtxMenu}
            className="w-full flex items-center gap-1 py-0.5 text-sm hover:opacity-80 transition-opacity text-left text-body"
            style={{ paddingLeft: depth * 16 + 8 }}
            aria-expanded={expanded}
            aria-label={`Folder ${node.name}`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="currentColor"
              className="flex-shrink-0 transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            >
              <path d="M4 2l4 4-4 4V2z" />
            </svg>
            {isRenaming ? (
              <RenameInput
                initialName={node.name}
                onSubmit={(newName) => onRenameSubmit(node.path, newName)}
                onCancel={onRenameCancel}
              />
            ) : (
              <span className="truncate">{node.name}/</span>
            )}
          </button>
        </div>
        {expanded && (
          node.children === undefined ? (
            <div className="py-0.5 text-xs text-muted" style={{ paddingLeft: (depth + 1) * 16 + 8 }}>Loading...</div>
          ) : (
            node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFilePath={selectedFilePath}
                expandedPaths={expandedPaths}
                onToggleDir={onToggleDir}
                onExpandDir={onExpandDir}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                renamingPath={renamingPath}
                onRenameSubmit={onRenameSubmit}
                onRenameCancel={onRenameCancel}
                isThemesCwd={isThemesCwd}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                draggedPath={draggedPath}
                dropTargetPath={dropTargetPath}
                onDropOnFolder={onDropOnFolder}
                onDragOverFolder={onDragOverFolder}
                onDragLeaveFolder={onDragLeaveFolder}
              />
            ))
          )
        )}
      </div>
    )
  }

  const isSelected = node.path === selectedFilePath
  const showApply = isThemesCwd && node.name.endsWith('.css') && !isRenaming

  return (
    <div
      className="flex items-center rounded"
      style={{
        paddingLeft: depth * 16 + 8,
        backgroundColor: isSelected ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)' : 'transparent',
      }}
      draggable={!isRenaming}
      onDragStart={handleDragStartNode}
      onDragEnd={handleDragEndNode}
    >
      <button
        onClick={() => !isRenaming && onSelect(node.path)}
        onContextMenu={handleCtxMenu}
        className="flex-1 min-w-0 flex items-center gap-1 py-0.5 text-sm hover:opacity-80 transition-opacity text-left text-body"
        aria-selected={isSelected}
        aria-label={`File ${node.name}`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="flex-shrink-0 text-muted">
          <path d="M2 1h5l3 3v7H2V1zm5 0v3h3" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
        {isRenaming ? (
          <RenameInput
            initialName={node.name}
            onSubmit={(newName) => onRenameSubmit(node.path, newName)}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </button>
      {showApply && <ApplyThemeButton filename={node.name} />}
    </div>
  )
}

// ── Monaco File Editor ─────────────────────────────────────────

function MonacoFileEditor({ content, language }: { content: string; language: string | null }) {
  const { editorContent, setEditorContent, saveFile } = useFileExplorerStore()

  const handleMount = (editor: any, monaco: any) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveFile())
  }

  return (
    <Editor
      height="100%"
      language={toMonacoLanguage(language)}
      theme="vs-dark"
      value={editorContent ?? content}
      onChange={(val) => setEditorContent(val ?? '')}
      onMount={handleMount}
      options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false }}
    />
  )
}

// ── Viewer Header ──────────────────────────────────────────────

const HTML_EXTENSIONS = new Set(['html', 'htm'])

function isMonacoActive(fileLanguage: string | null, filePath: string, viewMode: string): boolean {
  if (fileLanguage === 'image') return false
  const ext = getFileExtension(filePath)
  if (viewMode === 'preview' && PREVIEW_EXTENSIONS.has(ext)) return false
  return true
}

function ViewerHeader({ filePath, isThemesCwd, jsEnabled, onToggleJs, onExpand }: {
  filePath: string; isThemesCwd: boolean; jsEnabled: boolean; onToggleJs: () => void; onExpand: () => void
}) {
  const { isDirty, viewMode, setViewMode, saveFile, fileLanguage } = useFileExplorerStore()
  const canToggle = hasPreviewMode(fileLanguage, filePath)
  const name = getBasename(filePath)
  const showApplyTheme = isThemesCwd && getFileExtension(filePath) === 'css'
  const showJsToggle = viewMode === 'preview' && HTML_EXTENSIONS.has(getFileExtension(filePath))
  const showExpand = fileLanguage === 'image' || isMonacoActive(fileLanguage, filePath, viewMode) || (viewMode === 'preview' && PREVIEW_EXTENSIONS.has(getFileExtension(filePath)))

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-base flex-shrink-0 bg-surface"
    >
      <span className="text-xs truncate flex-1 text-muted" title={filePath}>
        {name}
      </span>
      {isDirty && (
        <span className="text-xs px-1.5 py-0.5 rounded bg-warning" style={{ color: '#000' }}>
          modified
        </span>
      )}
      {isDirty && (
        <button
          onClick={() => saveFile()}
          className="text-xs px-2 py-0.5 rounded hover:opacity-80 transition-opacity bg-primary text-contrast"
          aria-label="Save file"
        >
          Save
        </button>
      )}
      {showApplyTheme && <ApplyThemeButton filename={name} />}
      {showJsToggle && (
        <button
          onClick={onToggleJs}
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-opacity hover:opacity-80 ${
            jsEnabled ? 'bg-warning text-contrast' : 'bg-muted text-contrast'
          }`}
          title={jsEnabled ? 'Disable JavaScript' : 'Enable JavaScript'}
          aria-label={jsEnabled ? 'Disable JavaScript' : 'Enable JavaScript'}
          aria-pressed={jsEnabled}
        >
          JS
        </button>
      )}
      {showExpand && (
        <button
          onClick={onExpand}
          className="px-2.5 py-1 rounded text-xs font-medium transition-colors hover:opacity-80"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text-muted)',
            border: '1px solid color-mix(in srgb, var(--color-text-muted) 20%, transparent)',
          }}
          aria-label="Expand preview"
        >
          Expand ↗
        </button>
      )}
      {canToggle && (
        <button
          onClick={() => setViewMode(viewMode === 'preview' ? 'source' : 'preview')}
          className="p-1 rounded hover:opacity-80 transition-opacity text-muted"
          title={viewMode === 'preview' ? 'View source' : 'View preview'}
          aria-label={viewMode === 'preview' ? 'Switch to source view' : 'Switch to preview'}
        >
          {viewMode === 'preview' ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="4,2 7,2 7,6" /><polyline points="9,2 12,2 12,6" />
              <polyline points="4,10 7,10 7,14" /><polyline points="9,10 12,10 12,14" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="3" /><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
            </svg>
          )}
        </button>
      )}
    </div>
  )
}

// ── File Viewer ───────────────────────────────────────────────

function FileViewer({ filePath, content, language, allowScripts }: {
  filePath: string; content: string; language: string | null; allowScripts?: boolean
}) {
  const { viewMode } = useFileExplorerStore()
  const ext = getFileExtension(filePath)

  // Raster images — always image preview, no toggle
  if (language === 'image') {
    return (
      <div className="h-full w-full overflow-auto flex items-center justify-center p-4">
        <img
          src={content}
          alt={getBasename(filePath)}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          draggable={false}
        />
      </div>
    )
  }

  // Previewable files in preview mode → specialized viewer
  if (viewMode === 'preview' && PREVIEW_EXTENSIONS.has(ext)) {
    if (ext === 'svg') return <SvgPreview content={content} />
    if (ext === 'html' || ext === 'htm') return <HtmlPreview filePath={filePath} allowScripts={allowScripts} />
    if (ext === 'md' || ext === 'markdown') return <MarkdownArtifact content={content} />
    if (ext === 'mmd') {
      return (
        <div className="h-full overflow-auto p-4 flex justify-center">
          <MermaidBlock content={content} />
        </div>
      )
    }
  }

  // Everything else (code files, or source mode) → Monaco
  return <MonacoFileEditor content={content} language={language} />
}

// ── JS Permission Banner ──────────────────────────────────────

function JsPermissionBanner({ filePath, onAllowOnce, onTrustFolder, onTrustAll, onDismiss }: {
  filePath: string
  onAllowOnce: () => void
  onTrustFolder: () => void
  onTrustAll: () => void
  onDismiss: () => void
}) {
  const folder = filePath.substring(0, filePath.lastIndexOf('/')) || '/'

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="status-block-warning rounded-lg p-5 max-w-md w-full">
        <div className="flex items-center gap-2 mb-3">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="flex-shrink-0 text-warning">
            <path d="M10 2L1 18h18L10 2zm0 3l7 12H3l7-12zm-1 5v4h2v-4H9zm0 5v2h2v-2H9z" />
          </svg>
          <span className="font-medium text-body">JavaScript is disabled for security</span>
        </div>
        <p className="text-sm text-muted mb-4">
          This HTML file may contain scripts. Choose how to proceed:
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onAllowOnce}
            className="w-full text-sm px-3 py-1.5 rounded hover:opacity-80 transition-opacity bg-primary text-contrast"
            aria-label="Allow JavaScript for this file only"
          >
            Allow once
          </button>
          <button
            onClick={onTrustFolder}
            className="w-full text-sm px-3 py-1.5 rounded hover:opacity-80 transition-opacity bg-accent text-contrast"
            title={folder}
            aria-label={`Always allow JavaScript for ${folder}`}
          >
            Always for this folder
          </button>
          <button
            onClick={onTrustAll}
            className="w-full text-sm px-3 py-1.5 rounded hover:opacity-80 transition-opacity bg-warning"
            style={{ color: '#000' }}
            aria-label="Always allow JavaScript for all files"
          >
            Always allow
          </button>
          <button
            onClick={onDismiss}
            className="w-full text-sm px-3 py-1.5 rounded hover:opacity-80 transition-opacity text-muted border border-base"
            aria-label="Continue without JavaScript"
          >
            Continue without JS
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────

// ── Create Input ──────────────────────────────────────────────

function CreateInput({ kind, onSubmit, onCancel }: {
  kind: 'file' | 'folder'
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    if (doneRef.current) return
    doneRef.current = true
    const trimmed = value.trim()
    if (trimmed) {
      onSubmit(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <div className="flex items-center gap-1 py-0.5 px-2">
      <span className="text-xs text-muted flex-shrink-0">{kind === 'file' ? '📄' : '📁'}</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          else if (e.key === 'Escape') { doneRef.current = true; onCancel() }
        }}
        onBlur={submit}
        onClick={(e) => e.stopPropagation()}
        className="text-sm rounded px-1 outline-none flex-1 min-w-0 bg-deep text-body border border-primary"
        placeholder={`New ${kind} name`}
        aria-label={`New ${kind} name`}
      />
    </div>
  )
}

export function FileExplorerPanel() {
  const { tree, selectedFilePath, fileContent, editorContent, fileLanguage, fileWarning, loading, error, refresh, selectFile, cwd, expandedPaths, toggleDir, expandDir, viewMode } = useFileExplorerStore()
  const themesCwd = isThemesDirectory(cwd)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [jsEnabled, setJsEnabled] = useState(false)
  const [jsPromptDismissed, setJsPromptDismissed] = useState(false)
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [showPreviewModal, setShowPreviewModal] = useState(false)

  // DnD state
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

  // Create state: { kind, dirPath } — dirPath is where to create
  const [creating, setCreating] = useState<{ kind: 'file' | 'folder'; dirPath: string } | null>(null)

  // Load JS trust settings on mount
  useEffect(() => {
    useFileExplorerStore.getState().loadJsTrust()
  }, [])

  // Reset JS state when file selection changes; auto-enable for trusted files
  useEffect(() => {
    if (selectedFilePath) {
      const ext = getFileExtension(selectedFilePath)
      if (HTML_EXTENSIONS.has(ext) && useFileExplorerStore.getState().isJsTrusted(selectedFilePath)) {
        setJsEnabled(true)
      } else {
        setJsEnabled(false)
      }
    } else {
      setJsEnabled(false)
    }
    setJsPromptDismissed(false)
    setShowCodeModal(false)
    setShowPreviewModal(false)
  }, [selectedFilePath])

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }, [])

  const handleCloseMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleStartRename = useCallback(() => {
    if (contextMenu) setRenamingPath(contextMenu.node.path)
  }, [contextMenu])

  const handleRenameSubmit = useCallback(async (oldPath: string, newName: string) => {
    setRenamingPath(null)
    try {
      const newPath = await window.agent.files.rename(oldPath, newName)
      await refresh()
      if (selectedFilePath === oldPath) {
        selectFile(newPath)
      }
    } catch {
      // Rename failed — tree already refreshed or unchanged
    }
  }, [refresh, selectFile, selectedFilePath])

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null)
  }, [])

  // ── DnD handlers ───────────────────────────────────────────
  const handleDragStart = useCallback((path: string) => {
    setDraggedPath(path)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedPath(null)
    setDropTargetPath(null)
  }, [])

  const handleDragOverFolder = useCallback((folderPath: string) => {
    setDropTargetPath(folderPath)
  }, [])

  const handleDragLeaveFolder = useCallback(() => {
    setDropTargetPath(null)
  }, [])

  const handleDropOnFolder = useCallback(async (folderPath: string) => {
    if (!draggedPath) return
    setDraggedPath(null)
    setDropTargetPath(null)
    try {
      await window.agent.files.move(draggedPath, folderPath)
      await refresh()
    } catch { /* move failed */ }
  }, [draggedPath, refresh])

  // Drop on tree root → move to cwd
  const handleTreeRootDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const sourcePath = e.dataTransfer.getData('text/plain')
    if (!sourcePath || !cwd) return
    setDraggedPath(null)
    setDropTargetPath(null)
    try {
      await window.agent.files.move(sourcePath, cwd)
      await refresh()
    } catch { /* move failed */ }
  }, [cwd, refresh])

  const handleTreeRootDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  // ── Create handlers ────────────────────────────────────────
  const handleCreateSubmit = useCallback(async (name: string) => {
    if (!creating) return
    const { kind, dirPath } = creating
    setCreating(null)
    try {
      if (kind === 'file') {
        const newPath = await window.agent.files.createFile(dirPath, name)
        await refresh()
        selectFile(newPath)
      } else {
        await window.agent.files.createFolder(dirPath, name)
        await refresh()
      }
    } catch { /* create failed */ }
  }, [creating, refresh, selectFile])

  const handleCreateCancel = useCallback(() => {
    setCreating(null)
  }, [])

  const handleCreateFileInDir = useCallback((dirPath: string) => {
    setCreating({ kind: 'file', dirPath })
  }, [])

  const handleCreateFolderInDir = useCallback((dirPath: string) => {
    setCreating({ kind: 'folder', dirPath })
  }, [])

  // Close context menu on tree scroll
  const treeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = treeRef.current
    if (!el || !contextMenu) return
    const handleScroll = () => setContextMenu(null)
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [contextMenu])

  return (
    <div className="flex flex-col h-full" role="complementary" aria-label="File Explorer">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-base flex-shrink-0 bg-surface"
      >
        <span className="text-sm font-medium text-body">Files</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => cwd && setCreating({ kind: 'file', dirPath: cwd })}
            title="New File"
            className="p-1 rounded hover:opacity-80 transition-opacity text-muted"
            aria-label="New File"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 1h6l4 4v10H3V1z" /><path d="M9 1v4h4" /><path d="M8 8v4M6 10h4" />
            </svg>
          </button>
          <button
            onClick={() => cwd && setCreating({ kind: 'folder', dirPath: cwd })}
            title="New Folder"
            className="p-1 rounded hover:opacity-80 transition-opacity text-muted"
            aria-label="New Folder"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 3h5l2 2h7v9H1V3z" /><path d="M8 8v4M6 10h4" />
            </svg>
          </button>
          <button
            onClick={() => refresh()}
            title="Refresh file tree"
            className="p-1 rounded hover:opacity-80 transition-opacity text-muted"
            aria-label="Refresh file tree"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.65 2.35A8 8 0 103.35 13.65 8 8 0 0013.65 2.35zM8 14A6 6 0 118 2a6 6 0 010 12z" />
              <path d="M11.5 8H14l-3-3-3 3h2.5z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="px-3 py-2 text-xs flex-shrink-0 bg-error text-contrast"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* File tree */}
      <div
        ref={treeRef}
        className="h-[40%] overflow-y-auto flex-shrink-0 border-b border-base bg-surface"
        role="tree"
        aria-label="File tree"
        onDrop={handleTreeRootDrop}
        onDragOver={handleTreeRootDragOver}
      >
        {/* Inline creation input at top of tree */}
        {creating && creating.dirPath === cwd && (
          <CreateInput kind={creating.kind} onSubmit={handleCreateSubmit} onCancel={handleCreateCancel} />
        )}
        {loading && tree.length === 0 ? (
          <div className="p-3 text-sm text-muted">Loading...</div>
        ) : tree.length === 0 && !creating ? (
          <div className="p-3 text-sm text-muted">No files found</div>
        ) : (
          tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedFilePath={selectedFilePath}
              expandedPaths={expandedPaths}
              onToggleDir={toggleDir}
              onExpandDir={expandDir}
              onSelect={selectFile}
              onContextMenu={handleContextMenu}
              renamingPath={renamingPath}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={handleRenameCancel}
              isThemesCwd={themesCwd}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              draggedPath={draggedPath}
              dropTargetPath={dropTargetPath}
              onDropOnFolder={handleDropOnFolder}
              onDragOverFolder={handleDragOverFolder}
              onDragLeaveFolder={handleDragLeaveFolder}
            />
          ))
        )}
      </div>

      {/* File viewer */}
      <div className="flex-1 flex flex-col overflow-hidden bg-deep">
        {selectedFilePath && fileContent !== null ? (() => {
          const isHtml = HTML_EXTENSIONS.has(getFileExtension(selectedFilePath))
          const showJsPrompt = isHtml && !jsEnabled && !jsPromptDismissed && viewMode === 'preview'
          const dir = selectedFilePath.substring(0, selectedFilePath.lastIndexOf('/')) || '/'

          return (
            <>
              <ViewerHeader
                filePath={selectedFilePath}
                isThemesCwd={themesCwd}
                jsEnabled={jsEnabled}
                onToggleJs={() => setJsEnabled((v) => !v)}
                onExpand={() => {
                  if (isMonacoActive(fileLanguage, selectedFilePath, viewMode)) {
                    setShowCodeModal(true)
                  } else {
                    setShowPreviewModal(true)
                  }
                }}
              />
              {fileWarning && (
                <div className="px-3 py-1.5 text-xs flex-shrink-0 bg-warning" style={{ color: '#000' }} role="alert">
                  {fileWarning}
                </div>
              )}
              <div className="flex-1 overflow-hidden">
                {showJsPrompt ? (
                  <JsPermissionBanner
                    filePath={selectedFilePath}
                    onAllowOnce={() => setJsEnabled(true)}
                    onTrustFolder={() => {
                      useFileExplorerStore.getState().addTrustedFolder(dir)
                      setJsEnabled(true)
                    }}
                    onTrustAll={() => {
                      useFileExplorerStore.getState().setJsTrustAll()
                      setJsEnabled(true)
                    }}
                    onDismiss={() => setJsPromptDismissed(true)}
                  />
                ) : (
                  <FileViewer filePath={selectedFilePath} content={fileContent} language={fileLanguage} allowScripts={jsEnabled} />
                )}
              </div>
            </>
          )
        })() : (
          <div
            className="flex items-center justify-center h-full text-sm text-muted"
          >
            Select a file to preview
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={handleCloseMenu}
          onRename={handleStartRename}
          onCreateFile={handleCreateFileInDir}
          onCreateFolder={handleCreateFolderInDir}
        />
      )}

      {/* Expanded code editor modal */}
      {showCodeModal && selectedFilePath && fileContent !== null && (
        <CodeEditorModal
          value={editorContent ?? fileContent!}
          onChange={(v) => useFileExplorerStore.getState().setEditorContent(v)}
          onClose={() => setShowCodeModal(false)}
          language={fileLanguage}
          filename={getBasename(selectedFilePath)}
        />
      )}

      {showPreviewModal && selectedFilePath && fileContent !== null && (
        <PreviewModal
          filePath={selectedFilePath}
          content={fileContent}
          language={fileLanguage}
          allowScripts={jsEnabled}
          onClose={() => setShowPreviewModal(false)}
        />
      )}
    </div>
  )
}
