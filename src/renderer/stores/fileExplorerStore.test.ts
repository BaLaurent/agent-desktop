import { describe, it, expect, beforeEach } from 'vitest'
import { useFileExplorerStore } from './fileExplorerStore'
import { mockAgent } from '../__tests__/setup'
import { act } from '@testing-library/react'
import type { FileNode } from '../../shared/types'

// Root-level nodes (flat — no children, as listDir returns)
const makeFlatTree = (): FileNode[] => [
  { name: 'src', path: '/test/src', isDirectory: true },
  { name: 'README.md', path: '/test/README.md', isDirectory: false },
]

// Children of /test/src
const makeSrcChildren = (): FileNode[] => [
  { name: 'index.ts', path: '/test/src/index.ts', isDirectory: false },
  { name: 'utils.ts', path: '/test/src/utils.ts', isDirectory: false },
]

describe('fileExplorerStore', () => {
  beforeEach(() => {
    act(() => {
      useFileExplorerStore.getState().clear()
    })
  })

  // ── loadTree ────────────────────────────────────────────

  it('loadTree sets tree and cwd via listDir', async () => {
    const tree = makeFlatTree()
    mockAgent.files.listDir.mockResolvedValueOnce(tree)

    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    const state = useFileExplorerStore.getState()
    expect(state.tree).toEqual(tree)
    expect(state.cwd).toBe('/test')
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.expandedPaths.size).toBe(0)
    expect(mockAgent.files.listDir).toHaveBeenCalledWith('/test')
  })

  it('loadTree clears previous selection and expanded paths', async () => {
    useFileExplorerStore.setState({
      selectedFilePath: '/old/file.ts',
      fileContent: 'old content',
      fileLanguage: 'typescript',
      expandedPaths: new Set(['/old/dir']),
    })

    mockAgent.files.listDir.mockResolvedValueOnce([])

    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/new')
    })

    const state = useFileExplorerStore.getState()
    expect(state.selectedFilePath).toBeNull()
    expect(state.fileContent).toBeNull()
    expect(state.expandedPaths.size).toBe(0)
  })

  it('loadTree sets error on failure', async () => {
    mockAgent.files.listDir.mockRejectedValueOnce(new Error('Permission denied'))

    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/bad')
    })

    const state = useFileExplorerStore.getState()
    expect(state.error).toBe('Permission denied')
    expect(state.tree).toEqual([])
  })

  // ── expandDir / collapseDir / toggleDir ─────────────────

  it('expandDir loads children and adds to expandedPaths', async () => {
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    mockAgent.files.listDir.mockResolvedValueOnce(makeSrcChildren())
    await act(async () => {
      await useFileExplorerStore.getState().expandDir('/test/src')
    })

    const state = useFileExplorerStore.getState()
    expect(state.expandedPaths.has('/test/src')).toBe(true)
    // Children should be set on the node
    const srcNode = state.tree.find(n => n.path === '/test/src')
    expect(srcNode?.children).toEqual(makeSrcChildren())
    expect(mockAgent.files.listDir).toHaveBeenLastCalledWith('/test/src')
  })

  it('expandDir is a no-op when already expanded', async () => {
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    mockAgent.files.listDir.mockResolvedValueOnce(makeSrcChildren())
    await act(async () => {
      await useFileExplorerStore.getState().expandDir('/test/src')
    })

    mockAgent.files.listDir.mockClear()
    await act(async () => {
      await useFileExplorerStore.getState().expandDir('/test/src')
    })

    // Should NOT have called listDir again
    expect(mockAgent.files.listDir).not.toHaveBeenCalled()
  })

  it('expandDir removes from expandedPaths on error', async () => {
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    mockAgent.files.listDir.mockRejectedValueOnce(new Error('Access denied'))
    await act(async () => {
      await useFileExplorerStore.getState().expandDir('/test/src')
    })

    const state = useFileExplorerStore.getState()
    expect(state.expandedPaths.has('/test/src')).toBe(false)
    expect(state.error).toBe('Access denied')
  })

  it('collapseDir removes path and descendants from expandedPaths', async () => {
    useFileExplorerStore.setState({
      expandedPaths: new Set(['/test/src', '/test/src/deep', '/test/other']),
    })

    act(() => {
      useFileExplorerStore.getState().collapseDir('/test/src')
    })

    const expanded = useFileExplorerStore.getState().expandedPaths
    expect(expanded.has('/test/src')).toBe(false)
    expect(expanded.has('/test/src/deep')).toBe(false)
    expect(expanded.has('/test/other')).toBe(true) // unrelated — not collapsed
  })

  it('toggleDir expands a collapsed dir', async () => {
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    mockAgent.files.listDir.mockResolvedValueOnce(makeSrcChildren())
    await act(async () => {
      await useFileExplorerStore.getState().toggleDir('/test/src')
    })

    expect(useFileExplorerStore.getState().expandedPaths.has('/test/src')).toBe(true)
  })

  it('toggleDir collapses an expanded dir', async () => {
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    mockAgent.files.listDir.mockResolvedValueOnce(makeSrcChildren())
    await act(async () => {
      await useFileExplorerStore.getState().expandDir('/test/src')
    })

    await act(async () => {
      await useFileExplorerStore.getState().toggleDir('/test/src')
    })

    expect(useFileExplorerStore.getState().expandedPaths.has('/test/src')).toBe(false)
  })

  // ── selectFile ──────────────────────────────────────────

  it('selectFile sets content and language', async () => {
    mockAgent.files.readFile.mockResolvedValueOnce({ content: 'hello world', language: 'typescript' })

    await act(async () => {
      await useFileExplorerStore.getState().selectFile('/test/src/index.ts')
    })

    const state = useFileExplorerStore.getState()
    expect(state.selectedFilePath).toBe('/test/src/index.ts')
    expect(state.fileContent).toBe('hello world')
    expect(state.fileLanguage).toBe('typescript')
    expect(state.loading).toBe(false)
  })

  it('selectFile sets error on failure', async () => {
    mockAgent.files.readFile.mockRejectedValueOnce(new Error('File not found'))

    await act(async () => {
      await useFileExplorerStore.getState().selectFile('/bad/path')
    })

    const state = useFileExplorerStore.getState()
    expect(state.error).toBe('File not found')
    expect(state.loading).toBe(false)
  })

  // ── refresh ─────────────────────────────────────────────

  it('refresh reloads root via listDir', async () => {
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    const newTree: FileNode[] = [{ name: 'new.ts', path: '/test/new.ts', isDirectory: false }]
    mockAgent.files.listDir.mockResolvedValueOnce(newTree)

    await act(async () => {
      await useFileExplorerStore.getState().refresh()
    })

    const state = useFileExplorerStore.getState()
    expect(state.tree).toEqual(newTree)
    expect(mockAgent.files.listDir).toHaveBeenLastCalledWith('/test')
  })

  it('refresh reloads expanded directories in parallel', async () => {
    // Load root
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    // Expand src
    mockAgent.files.listDir.mockResolvedValueOnce(makeSrcChildren())
    await act(async () => {
      await useFileExplorerStore.getState().expandDir('/test/src')
    })

    // Refresh: should reload both root and /test/src
    mockAgent.files.listDir
      .mockResolvedValueOnce(makeFlatTree())  // root
      .mockResolvedValueOnce(makeSrcChildren()) // /test/src

    await act(async () => {
      await useFileExplorerStore.getState().refresh()
    })

    const state = useFileExplorerStore.getState()
    expect(state.expandedPaths.has('/test/src')).toBe(true)
    const srcNode = state.tree.find(n => n.path === '/test/src')
    expect(srcNode?.children).toEqual(makeSrcChildren())
  })

  it('refresh clears selection if file no longer in tree', async () => {
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    // Expand + select a nested file
    mockAgent.files.listDir.mockResolvedValueOnce(makeSrcChildren())
    await act(async () => {
      await useFileExplorerStore.getState().expandDir('/test/src')
    })
    mockAgent.files.readFile.mockResolvedValueOnce({ content: 'code', language: 'typescript' })
    await act(async () => {
      await useFileExplorerStore.getState().selectFile('/test/src/index.ts')
    })

    // Refresh: src dir is gone
    const newTree: FileNode[] = [{ name: 'other.ts', path: '/test/other.ts', isDirectory: false }]
    mockAgent.files.listDir.mockResolvedValueOnce(newTree)

    await act(async () => {
      await useFileExplorerStore.getState().refresh()
    })

    const state = useFileExplorerStore.getState()
    expect(state.selectedFilePath).toBeNull()
    expect(state.fileContent).toBeNull()
  })

  it('refresh preserves selection if file still exists', async () => {
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    mockAgent.files.readFile.mockResolvedValueOnce({ content: 'readme', language: 'markdown' })
    await act(async () => {
      await useFileExplorerStore.getState().selectFile('/test/README.md')
    })

    // Refresh with same root
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().refresh()
    })

    expect(useFileExplorerStore.getState().selectedFilePath).toBe('/test/README.md')
  })

  it('refresh drops expanded paths that no longer exist', async () => {
    mockAgent.files.listDir.mockResolvedValueOnce(makeFlatTree())
    await act(async () => {
      await useFileExplorerStore.getState().loadTree('/test')
    })

    // Expand src
    mockAgent.files.listDir.mockResolvedValueOnce(makeSrcChildren())
    await act(async () => {
      await useFileExplorerStore.getState().expandDir('/test/src')
    })

    // Refresh: root no longer has src/
    const newTree: FileNode[] = [{ name: 'README.md', path: '/test/README.md', isDirectory: false }]
    mockAgent.files.listDir
      .mockResolvedValueOnce(newTree)    // root (no src dir)
      .mockResolvedValueOnce([])         // /test/src attempt (would fail but caught)

    await act(async () => {
      await useFileExplorerStore.getState().refresh()
    })

    const state = useFileExplorerStore.getState()
    expect(state.expandedPaths.has('/test/src')).toBe(false)
  })

  it('refresh does nothing when cwd is null', async () => {
    await act(async () => {
      await useFileExplorerStore.getState().refresh()
    })

    expect(mockAgent.files.listDir).not.toHaveBeenCalled()
  })

  // ── clear ───────────────────────────────────────────────

  it('clear resets all state', () => {
    useFileExplorerStore.setState({
      tree: makeFlatTree(),
      expandedPaths: new Set(['/test/src']),
      selectedFilePath: '/test/file.ts',
      fileContent: 'content',
      fileLanguage: 'typescript',
      loading: true,
      error: 'some error',
      cwd: '/test',
    })

    act(() => {
      useFileExplorerStore.getState().clear()
    })

    const state = useFileExplorerStore.getState()
    expect(state.tree).toEqual([])
    expect(state.expandedPaths.size).toBe(0)
    expect(state.selectedFilePath).toBeNull()
    expect(state.fileContent).toBeNull()
    expect(state.fileLanguage).toBeNull()
    expect(state.fileWarning).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.cwd).toBeNull()
  })

  // ── JS trust ─────────────────────────────────────────────

  it('loadJsTrust loads folders and trustAll from settings', async () => {
    mockAgent.settings.get
      .mockResolvedValueOnce('["/home/user/trusted"]')  // html_jsTrustedFolders
      .mockResolvedValueOnce('true')                     // html_jsTrustAll

    await act(async () => {
      await useFileExplorerStore.getState().loadJsTrust()
    })

    const state = useFileExplorerStore.getState()
    expect(state.jsTrustedFolders).toEqual(['/home/user/trusted'])
    expect(state.jsTrustAll).toBe(true)
  })

  it('loadJsTrust defaults to empty when settings are absent', async () => {
    mockAgent.settings.get
      .mockResolvedValueOnce(null)  // no folders
      .mockResolvedValueOnce(null)  // no trustAll

    await act(async () => {
      await useFileExplorerStore.getState().loadJsTrust()
    })

    const state = useFileExplorerStore.getState()
    expect(state.jsTrustedFolders).toEqual([])
    expect(state.jsTrustAll).toBe(false)
  })

  it('addTrustedFolder appends folder and persists', async () => {
    useFileExplorerStore.setState({ jsTrustedFolders: ['/existing'] })

    await act(async () => {
      await useFileExplorerStore.getState().addTrustedFolder('/new/folder')
    })

    expect(useFileExplorerStore.getState().jsTrustedFolders).toEqual(['/existing', '/new/folder'])
    expect(mockAgent.settings.set).toHaveBeenCalledWith(
      'html_jsTrustedFolders',
      JSON.stringify(['/existing', '/new/folder']),
    )
  })

  it('setJsTrustAll sets flag and persists', async () => {
    await act(async () => {
      await useFileExplorerStore.getState().setJsTrustAll()
    })

    expect(useFileExplorerStore.getState().jsTrustAll).toBe(true)
    expect(mockAgent.settings.set).toHaveBeenCalledWith('html_jsTrustAll', 'true')
  })

  it('isJsTrusted returns true when jsTrustAll is set', () => {
    useFileExplorerStore.setState({ jsTrustAll: true, jsTrustedFolders: [] })
    expect(useFileExplorerStore.getState().isJsTrusted('/any/path/file.html')).toBe(true)
  })

  it('isJsTrusted returns true for files in trusted folders', () => {
    useFileExplorerStore.setState({ jsTrustAll: false, jsTrustedFolders: ['/home/user/project'] })
    expect(useFileExplorerStore.getState().isJsTrusted('/home/user/project/index.html')).toBe(true)
    expect(useFileExplorerStore.getState().isJsTrusted('/home/user/project/sub/page.html')).toBe(true)
  })

  it('isJsTrusted returns false for files outside trusted folders', () => {
    useFileExplorerStore.setState({ jsTrustAll: false, jsTrustedFolders: ['/home/user/project'] })
    expect(useFileExplorerStore.getState().isJsTrusted('/home/other/file.html')).toBe(false)
  })

  it('clear resets JS trust state', () => {
    useFileExplorerStore.setState({ jsTrustedFolders: ['/a'], jsTrustAll: true })

    act(() => {
      useFileExplorerStore.getState().clear()
    })

    const state = useFileExplorerStore.getState()
    expect(state.jsTrustedFolders).toEqual([])
    expect(state.jsTrustAll).toBe(false)
  })
})
