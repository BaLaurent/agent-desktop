import { render, screen } from '@testing-library/react'
import { useConversationsStore } from '../../stores/conversationsStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useMcpStore } from '../../stores/mcpStore'
import type { Conversation, Folder } from '../../../shared/types'

// Stub child components to isolate heatmap logic
vi.mock('./ConversationItem', () => ({
  ConversationItem: ({ conversation }: { conversation: Conversation }) => (
    <div data-testid={`conv-${conversation.id}`}>{conversation.title}</div>
  ),
}))
vi.mock('./EmptyState', () => ({
  EmptyState: () => <div>Empty</div>,
}))
vi.mock('../settings/FolderSettingsPopover', () => ({
  FolderSettingsPopover: () => null,
}))

// Must import after mocks are registered (hoisted by vitest)
import { SidebarTree } from './FolderTree'

const now = new Date().toISOString()

function makeFolder(overrides: Partial<Folder> & { id: number; name: string }): Folder {
  return {
    parent_id: null,
    position: 0,
    ai_overrides: null,
    default_cwd: null,
    color: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function makeConversation(overrides: Partial<Conversation> & { id: number }): Conversation {
  return {
    title: `Conv ${overrides.id}`,
    folder_id: null,
    position: 0,
    model: 'claude-sonnet-4-6-20250514',
    system_prompt: null,
    cwd: null,
    kb_enabled: 0,
    ai_overrides: null,
    cleared_at: null,
    compact_summary: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function setupStores(opts: {
  folders: Folder[]
  conversations: Conversation[]
  settings?: Record<string, string>
}) {
  useConversationsStore.setState({
    folders: opts.folders,
    conversations: opts.conversations,
    activeConversationId: null,
    searchQuery: '',
    isLoading: false,
    selectedIds: new Set(),
    lastClickedId: null,
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    updateConversation: vi.fn(),
    deleteFolder: vi.fn(),
    moveToFolder: vi.fn(),
    moveSelectedToFolder: vi.fn(),
    createConversation: vi.fn().mockResolvedValue({ id: 999 }),
    clearSelection: vi.fn(),
  })

  useSettingsStore.setState({
    settings: opts.settings ?? {},
    setSetting: vi.fn().mockResolvedValue(undefined),
  })

  useMcpStore.setState({
    servers: [],
    loadServers: vi.fn().mockResolvedValue(undefined),
  })
}

describe('FolderTree heatmap', () => {
  it('does not apply heatmap colors when disabled', () => {
    const folderA = makeFolder({ id: 1, name: 'Alpha' })
    const conv1 = makeConversation({ id: 10, folder_id: 1 })
    const conv2 = makeConversation({ id: 11, folder_id: 1 })

    setupStores({
      folders: [folderA],
      conversations: [conv1, conv2],
      settings: { heatmap_enabled: 'false' },
    })

    render(<SidebarTree />)
    const folderEl = screen.getByRole('treeitem', { name: /Folder: Alpha/ })
    // No borderLeft style when heatmap disabled and no manual color
    expect(folderEl.style.borderLeft).toBe('')
  })

  it('applies heatmap colors in relative mode based on conversation count', () => {
    const folderA = makeFolder({ id: 1, name: 'Low' })
    const folderB = makeFolder({ id: 2, name: 'High' })

    // folderA: 1 conversation, folderB: 5 conversations
    const conversations = [
      makeConversation({ id: 10, folder_id: 1 }),
      makeConversation({ id: 20, folder_id: 2 }),
      makeConversation({ id: 21, folder_id: 2 }),
      makeConversation({ id: 22, folder_id: 2 }),
      makeConversation({ id: 23, folder_id: 2 }),
      makeConversation({ id: 24, folder_id: 2 }),
    ]

    setupStores({
      folders: [folderA, folderB],
      conversations,
      settings: { heatmap_enabled: 'true', heatmap_mode: 'relative' },
    })

    render(<SidebarTree />)

    const lowFolder = screen.getByRole('treeitem', { name: /Folder: Low/ })
    const highFolder = screen.getByRole('treeitem', { name: /Folder: High/ })

    // Both should have borderLeft (heatmap assigns colors to all folders)
    expect(lowFolder.style.borderLeft).toContain('solid')
    expect(highFolder.style.borderLeft).toContain('solid')

    // Low count folder should be more green (hue closer to 120)
    // High count folder should be more red (hue closer to 0)
    // They should have different colors
    expect(lowFolder.style.borderLeft).not.toBe(highFolder.style.borderLeft)
  })

  it('manual folder color overrides heatmap color', () => {
    const manualColor = '#ff00ff'
    const folderA = makeFolder({ id: 1, name: 'Manual', color: manualColor })
    const conv = makeConversation({ id: 10, folder_id: 1 })

    setupStores({
      folders: [folderA],
      conversations: [conv],
      settings: { heatmap_enabled: 'true', heatmap_mode: 'relative' },
    })

    render(<SidebarTree />)
    const folderEl = screen.getByRole('treeitem', { name: /Folder: Manual/ })

    // Should use manual color, not heatmap color
    // jsdom normalizes hex to rgb, so check for the rgb equivalent
    expect(folderEl.style.borderLeft).toBe('3px solid rgb(255, 0, 255)')
  })

  it('applies heatmap colors in fixed mode with custom min/max', () => {
    const folderA = makeFolder({ id: 1, name: 'Below' })
    const folderB = makeFolder({ id: 2, name: 'Above' })

    // folderA: 2 conversations (below min=5 → clamped to 0 → green)
    // folderB: 10 conversations (at max=10 → clamped to 1 → red)
    const conversations = [
      makeConversation({ id: 10, folder_id: 1 }),
      makeConversation({ id: 11, folder_id: 1 }),
      ...Array.from({ length: 10 }, (_, i) =>
        makeConversation({ id: 20 + i, folder_id: 2 })
      ),
    ]

    setupStores({
      folders: [folderA, folderB],
      conversations,
      settings: {
        heatmap_enabled: 'true',
        heatmap_mode: 'fixed',
        heatmap_min: '5',
        heatmap_max: '10',
      },
    })

    render(<SidebarTree />)

    const belowFolder = screen.getByRole('treeitem', { name: /Folder: Below/ })
    const aboveFolder = screen.getByRole('treeitem', { name: /Folder: Above/ })

    // Both should have heatmap colors applied
    expect(belowFolder.style.borderLeft).toContain('solid')
    expect(aboveFolder.style.borderLeft).toContain('solid')

    // Below-min folder clamped to t=0 → green (hue=120): hsvToHex(120, 70, 80)
    // At-max folder clamped to t=1 → red (hue=0): hsvToHex(0, 70, 80)
    expect(belowFolder.style.borderLeft).not.toBe(aboveFolder.style.borderLeft)
  })

  it('counts conversations recursively in subfolders', () => {
    const parent = makeFolder({ id: 1, name: 'Parent' })
    const child = makeFolder({ id: 2, name: 'Child', parent_id: 1 })
    const other = makeFolder({ id: 3, name: 'Other' })

    // Parent has 1 direct + 2 in child = 3 total
    // Other has 1
    const conversations = [
      makeConversation({ id: 10, folder_id: 1 }),
      makeConversation({ id: 20, folder_id: 2 }),
      makeConversation({ id: 21, folder_id: 2 }),
      makeConversation({ id: 30, folder_id: 3 }),
    ]

    setupStores({
      folders: [parent, child, other],
      conversations,
      settings: { heatmap_enabled: 'true', heatmap_mode: 'relative' },
    })

    render(<SidebarTree />)

    const parentFolder = screen.getByRole('treeitem', { name: /Folder: Parent/ })
    const otherFolder = screen.getByRole('treeitem', { name: /Folder: Other/ })

    // Parent (3 convs) should be more red than Other (1 conv)
    // Both should have border styles
    expect(parentFolder.style.borderLeft).toContain('solid')
    expect(otherFolder.style.borderLeft).toContain('solid')
    expect(parentFolder.style.borderLeft).not.toBe(otherFolder.style.borderLeft)
  })

  it('returns null heatmap colors when heatmap_enabled is not set', () => {
    const folderA = makeFolder({ id: 1, name: 'NoSetting' })
    const conv = makeConversation({ id: 10, folder_id: 1 })

    setupStores({
      folders: [folderA],
      conversations: [conv],
      settings: {}, // no heatmap_enabled key at all
    })

    render(<SidebarTree />)
    const folderEl = screen.getByRole('treeitem', { name: /Folder: NoSetting/ })
    expect(folderEl.style.borderLeft).toBe('')
  })
})
