import { create } from 'zustand'
import type { FileNode } from '../../shared/types'

// ── Tree helpers ─────────────────────────────────────────────

function fileExistsInTree(nodes: FileNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.path === path) return true
    if (node.children && fileExistsInTree(node.children, path)) return true
  }
  return false
}

function setChildrenInTree(tree: FileNode[], dirPath: string, children: FileNode[]): FileNode[] {
  return tree.map(node => {
    if (node.path === dirPath) return { ...node, children }
    if (node.isDirectory && node.children) {
      return { ...node, children: setChildrenInTree(node.children, dirPath, children) }
    }
    return node
  })
}

// ── Types ────────────────────────────────────────────────────

type ViewMode = 'preview' | 'source'

interface FileExplorerState {
  tree: FileNode[]
  expandedPaths: Set<string>
  selectedFilePath: string | null
  fileContent: string | null
  fileLanguage: string | null
  fileWarning: string | null
  loading: boolean
  error: string | null
  cwd: string | null
  editorContent: string | null
  isDirty: boolean
  viewMode: ViewMode
  jsTrustedFolders: string[]
  jsTrustAll: boolean

  loadTree: (cwd: string) => Promise<void>
  expandDir: (dirPath: string) => Promise<void>
  collapseDir: (dirPath: string) => void
  toggleDir: (dirPath: string) => Promise<void>
  selectFile: (filePath: string) => Promise<void>
  refresh: () => Promise<void>
  clear: () => void
  setEditorContent: (content: string) => void
  saveFile: () => Promise<void>
  setViewMode: (mode: ViewMode) => void
  loadJsTrust: () => Promise<void>
  addTrustedFolder: (folder: string) => Promise<void>
  setJsTrustAll: () => Promise<void>
  isJsTrusted: (filePath: string) => boolean
}

// ── Store ────────────────────────────────────────────────────

export const useFileExplorerStore = create<FileExplorerState>((set, get) => ({
  tree: [],
  expandedPaths: new Set<string>(),
  selectedFilePath: null,
  fileContent: null,
  fileLanguage: null,
  fileWarning: null,
  loading: false,
  error: null,
  cwd: null,
  editorContent: null,
  isDirty: false,
  viewMode: 'preview' as ViewMode,
  jsTrustedFolders: [],
  jsTrustAll: false,

  loadTree: async (cwd) => {
    set({ loading: true, error: null })
    try {
      const tree = await window.agent.files.listDir(cwd)
      set({
        tree, cwd,
        expandedPaths: new Set(),
        selectedFilePath: null, fileContent: null, fileLanguage: null, fileWarning: null,
        editorContent: null, isDirty: false,
        loading: false,
      })
    } catch (err) {
      set({ tree: [], loading: false, error: err instanceof Error ? err.message : 'Failed to load file tree' })
    }
  },

  expandDir: async (dirPath) => {
    const { expandedPaths, tree } = get()
    if (expandedPaths.has(dirPath)) return

    const next = new Set(expandedPaths)
    next.add(dirPath)
    set({ expandedPaths: next })

    // Check if children are already cached in the tree
    const node = findNode(tree, dirPath)
    if (node && node.children === undefined) {
      try {
        const children = await window.agent.files.listDir(dirPath)
        set({ tree: setChildrenInTree(get().tree, dirPath, children) })
      } catch (err) {
        // Expansion failed — remove from expanded
        const curr = new Set(get().expandedPaths)
        curr.delete(dirPath)
        set({ expandedPaths: curr, error: err instanceof Error ? err.message : 'Failed to load directory' })
      }
    }
  },

  collapseDir: (dirPath) => {
    const next = new Set(get().expandedPaths)
    next.delete(dirPath)
    // Also collapse all descendant directories
    for (const p of next) {
      if (p.startsWith(dirPath + '/')) next.delete(p)
    }
    set({ expandedPaths: next })
  },

  toggleDir: async (dirPath) => {
    const { expandedPaths } = get()
    if (expandedPaths.has(dirPath)) {
      get().collapseDir(dirPath)
    } else {
      await get().expandDir(dirPath)
    }
  },

  selectFile: async (filePath) => {
    set({ loading: true, error: null, editorContent: null, isDirty: false, viewMode: 'preview', fileWarning: null })
    try {
      const { content, language, warning } = await window.agent.files.readFile(filePath)
      set({ selectedFilePath: filePath, fileContent: content, fileLanguage: language, fileWarning: warning || null, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to read file' })
    }
  },

  refresh: async () => {
    const { cwd, expandedPaths, selectedFilePath } = get()
    if (!cwd) return
    set({ loading: true, error: null })
    try {
      // Fetch root + all expanded dirs in parallel
      const pathsToFetch = [cwd, ...expandedPaths]
      const results = await Promise.all(
        pathsToFetch.map(p => window.agent.files.listDir(p).catch(() => null))
      )

      // Build tree: start with root
      let tree = results[0] || []

      // Apply expanded dirs' children in depth order (parents before children)
      const sortedPaths = [...expandedPaths].sort(
        (a, b) => a.split('/').length - b.split('/').length
      )
      const stillExpanded = new Set<string>()
      for (const dirPath of sortedPaths) {
        const idx = pathsToFetch.indexOf(dirPath)
        const children = results[idx]
        if (children !== null && fileExistsInTree(tree, dirPath)) {
          tree = setChildrenInTree(tree, dirPath, children)
          stillExpanded.add(dirPath)
        }
      }

      const selStillExists = selectedFilePath && fileExistsInTree(tree, selectedFilePath)
      set({
        tree,
        expandedPaths: stillExpanded,
        loading: false,
        ...(selStillExists
          ? {}
          : { selectedFilePath: null, fileContent: null, fileLanguage: null, fileWarning: null, editorContent: null, isDirty: false }),
      })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to refresh file tree' })
    }
  },

  clear: () => set({
    tree: [],
    expandedPaths: new Set(),
    selectedFilePath: null,
    fileContent: null,
    fileLanguage: null,
    fileWarning: null,
    loading: false,
    error: null,
    cwd: null,
    editorContent: null,
    isDirty: false,
    viewMode: 'preview' as ViewMode,
    jsTrustedFolders: [],
    jsTrustAll: false,
  }),

  setEditorContent: (content) => {
    const { fileContent } = get()
    set({ editorContent: content, isDirty: content !== fileContent })
  },

  saveFile: async () => {
    const { editorContent, selectedFilePath } = get()
    if (editorContent === null || !selectedFilePath) return
    try {
      await window.agent.files.writeFile(selectedFilePath, editorContent)
      set({ fileContent: editorContent, isDirty: false })
      get().refresh()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save file' })
    }
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  loadJsTrust: async () => {
    try {
      const [foldersRaw, trustAllRaw] = await Promise.all([
        window.agent.settings.get('html_jsTrustedFolders'),
        window.agent.settings.get('html_jsTrustAll'),
      ])
      let folders: string[] = []
      if (foldersRaw) {
        try { folders = JSON.parse(foldersRaw) } catch { /* invalid JSON, keep empty */ }
      }
      set({ jsTrustedFolders: folders, jsTrustAll: trustAllRaw === 'true' })
    } catch { /* settings read failed, keep defaults */ }
  },

  addTrustedFolder: async (folder) => {
    const next = [...get().jsTrustedFolders, folder]
    set({ jsTrustedFolders: next })
    try {
      await window.agent.settings.set('html_jsTrustedFolders', JSON.stringify(next))
    } catch { /* persist failed */ }
  },

  setJsTrustAll: async () => {
    set({ jsTrustAll: true })
    try {
      await window.agent.settings.set('html_jsTrustAll', 'true')
    } catch { /* persist failed */ }
  },

  isJsTrusted: (filePath) => {
    const { jsTrustAll, jsTrustedFolders } = get()
    if (jsTrustAll) return true
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    return jsTrustedFolders.some(f => dir === f || dir.startsWith(f + '/'))
  },
}))

// ── Private helpers ──────────────────────────────────────────

function findNode(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children) {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return null
}
