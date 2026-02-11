import { mockAgent } from '../__tests__/setup'
import { useConversationsStore } from './conversationsStore'
import type { Conversation, Folder } from '../../shared/types'

const makeConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 1,
  title: 'Test Conv',
  folder_id: null,
  position: 0,
  model: 'claude-sonnet-4-5-20250929',
  system_prompt: null,
  cwd: null,
  kb_enabled: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
})

beforeEach(() => {
  useConversationsStore.setState({
    conversations: [],
    folders: [],
    activeConversationId: null,
    searchQuery: '',
    isLoading: false,
  })
})

describe('conversationsStore', () => {
  it('loadConversations calls list and sets conversations', async () => {
    const convs = [makeConversation({ id: 1 }), makeConversation({ id: 2, title: 'Second' })]
    mockAgent.conversations.list.mockResolvedValueOnce(convs)

    await useConversationsStore.getState().loadConversations()

    expect(mockAgent.conversations.list).toHaveBeenCalled()
    expect(useConversationsStore.getState().conversations).toEqual(convs)
    expect(useConversationsStore.getState().isLoading).toBe(false)
  })

  it('createConversation prepends to list and sets activeConversationId', async () => {
    const existing = makeConversation({ id: 1 })
    useConversationsStore.setState({ conversations: [existing] })

    const created = makeConversation({ id: 2, title: 'New' })
    mockAgent.conversations.create.mockResolvedValueOnce(created)

    const result = await useConversationsStore.getState().createConversation('New')

    expect(result).toEqual(created)
    const state = useConversationsStore.getState()
    expect(state.conversations[0]).toEqual(created)
    expect(state.activeConversationId).toBe(2)
  })

  it('deleteConversation removes from list', async () => {
    const convs = [makeConversation({ id: 1 }), makeConversation({ id: 2 })]
    useConversationsStore.setState({ conversations: convs, activeConversationId: 1 })

    await useConversationsStore.getState().deleteConversation(2)

    expect(mockAgent.conversations.delete).toHaveBeenCalledWith(2)
    expect(useConversationsStore.getState().conversations).toHaveLength(1)
    expect(useConversationsStore.getState().activeConversationId).toBe(1)
  })

  it('deleteConversation resets activeConversationId if was active', async () => {
    useConversationsStore.setState({
      conversations: [makeConversation({ id: 1 })],
      activeConversationId: 1,
    })

    await useConversationsStore.getState().deleteConversation(1)

    expect(useConversationsStore.getState().activeConversationId).toBeNull()
  })

  it('setActiveConversation sets activeConversationId', () => {
    useConversationsStore.getState().setActiveConversation(42)
    expect(useConversationsStore.getState().activeConversationId).toBe(42)
  })

  it('searchConversations with empty query calls loadConversations', async () => {
    const convs = [makeConversation({ id: 1 })]
    mockAgent.conversations.list.mockResolvedValueOnce(convs)

    await useConversationsStore.getState().searchConversations('')

    expect(mockAgent.conversations.list).toHaveBeenCalled()
    expect(mockAgent.conversations.search).not.toHaveBeenCalled()
  })

  it('searchConversations with query calls search', async () => {
    const results = [makeConversation({ id: 3, title: 'Found' })]
    mockAgent.conversations.search.mockResolvedValueOnce(results)

    await useConversationsStore.getState().searchConversations('Found')

    expect(mockAgent.conversations.search).toHaveBeenCalledWith('Found')
    expect(useConversationsStore.getState().conversations).toEqual(results)
  })

  it('moveToFolder optimistically updates folder_id', async () => {
    const conv = makeConversation({ id: 1, folder_id: null })
    useConversationsStore.setState({ conversations: [conv] })

    await useConversationsStore.getState().moveToFolder(1, 5)

    expect(useConversationsStore.getState().conversations[0].folder_id).toBe(5)
    expect(mockAgent.conversations.update).toHaveBeenCalledWith(1, { folder_id: 5 })
  })

  it('exportConversation calls window.agent.conversations.export', async () => {
    mockAgent.conversations.export.mockResolvedValueOnce('# Exported')

    const result = await useConversationsStore.getState().exportConversation(1, 'markdown')

    expect(mockAgent.conversations.export).toHaveBeenCalledWith(1, 'markdown')
    expect(result).toBe('# Exported')
  })

  it('importConversation calls import then reloads list', async () => {
    const convs = [makeConversation({ id: 3, title: 'Imported' })]
    mockAgent.conversations.list.mockResolvedValueOnce(convs)

    await useConversationsStore.getState().importConversation('{"data":"test"}')

    expect(mockAgent.conversations.import).toHaveBeenCalledWith('{"data":"test"}')
    expect(mockAgent.conversations.list).toHaveBeenCalled()
  })

  describe('deleteFolder', () => {
    const makeFolder = (overrides: Partial<Folder> = {}): Folder => ({
      id: 1,
      name: 'Test Folder',
      parent_id: null,
      position: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    })

    it('default mode reparents conversations to root', async () => {
      const folder = makeFolder({ id: 10 })
      const conv = makeConversation({ id: 1, folder_id: 10 })
      useConversationsStore.setState({ folders: [folder], conversations: [conv] })

      await useConversationsStore.getState().deleteFolder(10)

      expect(mockAgent.folders.delete).toHaveBeenCalledWith(10)
      const state = useConversationsStore.getState()
      expect(state.folders).toHaveLength(0)
      expect(state.conversations[0].folder_id).toBeNull()
    })

    it('delete mode removes conversations in folder', async () => {
      const folder = makeFolder({ id: 10 })
      const convInside = makeConversation({ id: 1, folder_id: 10 })
      const convOutside = makeConversation({ id: 2, folder_id: null })
      useConversationsStore.setState({ folders: [folder], conversations: [convInside, convOutside] })

      await useConversationsStore.getState().deleteFolder(10, 'delete')

      expect(mockAgent.folders.delete).toHaveBeenCalledWith(10, 'delete')
      const state = useConversationsStore.getState()
      expect(state.folders).toHaveLength(0)
      expect(state.conversations).toHaveLength(1)
      expect(state.conversations[0].id).toBe(2)
    })

    it('delete mode clears activeConversationId if deleted', async () => {
      const folder = makeFolder({ id: 10 })
      const conv = makeConversation({ id: 5, folder_id: 10 })
      useConversationsStore.setState({ folders: [folder], conversations: [conv], activeConversationId: 5 })

      await useConversationsStore.getState().deleteFolder(10, 'delete')

      expect(useConversationsStore.getState().activeConversationId).toBeNull()
    })

    it('delete mode recursively purges child folders', async () => {
      const parent = makeFolder({ id: 10 })
      const child = makeFolder({ id: 11, parent_id: 10 })
      const grandchild = makeFolder({ id: 12, parent_id: 11 })
      const convDeep = makeConversation({ id: 1, folder_id: 12 })
      const convRoot = makeConversation({ id: 2, folder_id: null })
      useConversationsStore.setState({
        folders: [parent, child, grandchild],
        conversations: [convDeep, convRoot],
      })

      await useConversationsStore.getState().deleteFolder(10, 'delete')

      const state = useConversationsStore.getState()
      expect(state.folders).toHaveLength(0)
      expect(state.conversations).toHaveLength(1)
      expect(state.conversations[0].id).toBe(2)
    })

    it('rolls back on IPC error', async () => {
      const folder = makeFolder({ id: 10 })
      const conv = makeConversation({ id: 1, folder_id: 10 })
      useConversationsStore.setState({ folders: [folder], conversations: [conv], activeConversationId: 1 })
      mockAgent.folders.delete.mockRejectedValueOnce(new Error('fail'))

      await useConversationsStore.getState().deleteFolder(10, 'delete')

      const state = useConversationsStore.getState()
      expect(state.folders).toHaveLength(1)
      expect(state.conversations).toHaveLength(1)
      expect(state.activeConversationId).toBe(1)
    })
  })
})
