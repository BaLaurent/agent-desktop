import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi } from 'vitest'
import { mockAgent } from '../../__tests__/setup'
import { useFileExplorerStore } from '../../stores/fileExplorerStore'
import type { FileNode } from '../../../shared/types'
import { PreviewTab } from './PreviewTab'

// Seed the real file-explorer store with a single file node. No file is selected,
// so the heavy viewers (Monaco, artifact previews) never mount — the file tree and
// its context menu are all that render, keeping this a focused smoke test.
const fileNode: FileNode = { name: 'notes.txt', path: '/proj/notes.txt', isDirectory: false }

beforeEach(() => {
  useFileExplorerStore.setState({
    tree: [fileNode],
    cwd: '/proj',
    selectedFilePath: null,
    expandedPaths: new Set<string>(),
    multiSelectedPaths: new Set<string>(),
    loading: false,
    error: null,
  })
})

describe('PreviewTab — file context menu', () => {
  it('calls files.openTerminalHere with the node path from "Open in Terminal"', async () => {
    render(<PreviewTab />)

    // Right-click the file node to open its context menu.
    fireEvent.contextMenu(screen.getByLabelText('File notes.txt'))

    await act(async () => {
      fireEvent.click(screen.getByText('Open in Terminal'))
    })

    expect(mockAgent.files.openTerminalHere).toHaveBeenCalledWith('/proj/notes.txt')
  })
})
