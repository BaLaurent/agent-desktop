import { vi } from 'vitest'
import { mockAgent, capturedStreamListener, capturedConversationUpdatedListener } from '../__tests__/setup'
import { useChatStore, _streamBuffersMap, _streamTextMap } from './chatStore'
import type { StreamChunk } from '../../shared/types'
import { useSettingsStore } from './settingsStore'
import { DEFAULT_NOTIFICATION_CONFIG } from '../../shared/constants'

// Mock notification sounds — jsdom has no AudioContext
vi.mock('../utils/notificationSound', () => ({
  playCompletionSound: vi.fn(),
  playErrorSound: vi.fn(),
}))
import { playCompletionSound, playErrorSound } from '../utils/notificationSound'

function getStreamListener(): (chunk: StreamChunk) => void {
  if (!capturedStreamListener) throw new Error('Stream listener was not captured — chatStore module did not register onStream')
  return capturedStreamListener as (chunk: StreamChunk) => void
}

beforeEach(() => {
  _streamBuffersMap.clear()
  _streamTextMap.clear()
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    streamParts: [],
    streamingContent: '',
    isLoading: false,
    error: null,
    activeConversationId: null,
    messageQueues: {},
    queuePaused: {},
  })
})

describe('chatStore', () => {
  it('sendMessage adds user message optimistically and sets isStreaming', async () => {
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

    const promise = useChatStore.getState().sendMessage(1, 'Hello')

    // Check optimistic state immediately
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('user')
    expect(state.messages[0].content).toBe('Hello')
    expect(state.isStreaming).toBe(true)

    await promise
  })

  it('sendMessage calls window.agent.messages.send', async () => {
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

    await useChatStore.getState().sendMessage(1, 'Hello')

    expect(mockAgent.messages.send).toHaveBeenCalledWith(1, 'Hello', undefined)
  })

  it('sendMessage initializes streamBuffers entry for conversationId', async () => {
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

    const promise = useChatStore.getState().sendMessage(1, 'Hello')

    // Buffer should be initialized immediately (before await)
    expect(_streamBuffersMap.has(1)).toBe(true)
    expect(_streamBuffersMap.get(1)).toEqual([])

    await promise
  })

  it('sendMessage cleans up streamBuffers entry after completion', async () => {
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

    await useChatStore.getState().sendMessage(1, 'Hello')

    expect(_streamBuffersMap.has(1)).toBe(false)
  })

  it('stopGeneration calls window.agent.messages.stop with conversationId', async () => {
    useChatStore.setState({ activeConversationId: 42 })
    await useChatStore.getState().stopGeneration()
    expect(mockAgent.messages.stop).toHaveBeenCalledWith(42)
  })

  it('stopGeneration does nothing when no active conversation', async () => {
    useChatStore.setState({ activeConversationId: null })
    await useChatStore.getState().stopGeneration()
    expect(mockAgent.messages.stop).not.toHaveBeenCalled()
  })

  it('loadMessages populates messages from API', async () => {
    const msgs = [
      { id: 1, conversation_id: 1, role: 'user' as const, content: 'Hi', attachments: '[]', created_at: '', updated_at: '' },
      { id: 2, conversation_id: 1, role: 'assistant' as const, content: 'Hello!', attachments: '[]', created_at: '', updated_at: '' },
    ]
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: msgs })

    await useChatStore.getState().loadMessages(1)

    expect(useChatStore.getState().messages).toEqual(msgs)
    expect(useChatStore.getState().isLoading).toBe(false)
  })

  it('clearChat resets all state including streamBuffers', () => {
    _streamBuffersMap.set(1, [{ type: 'text', content: 'data' }])
    useChatStore.setState({
      messages: [{ id: 1, conversation_id: 1, role: 'user', content: 'x', attachments: '[]', created_at: '', updated_at: '' }],
      isStreaming: true,
      error: 'some error',
      activeConversationId: 1,
    })

    useChatStore.getState().clearChat()

    const state = useChatStore.getState()
    expect(state.messages).toEqual([])
    expect(state.isStreaming).toBe(false)
    expect(state.error).toBeNull()
    expect(state.activeConversationId).toBeNull()
    expect(_streamBuffersMap.size).toBe(0)
  })

  it('clearContext updates clearedAt state and calls conversations.update', async () => {
    await useChatStore.getState().clearContext(42)

    const state = useChatStore.getState()
    expect(state.clearedAt).toBeTruthy()
    // Should be a valid ISO date string
    expect(new Date(state.clearedAt!).toISOString()).toBe(state.clearedAt)
    expect(mockAgent.conversations.update).toHaveBeenCalledWith(42, expect.objectContaining({ cleared_at: state.clearedAt }))
  })

  it('clearChat resets clearedAt to null', () => {
    useChatStore.setState({ clearedAt: '2024-01-01T00:00:00.000Z' })
    useChatStore.getState().clearChat()
    expect(useChatStore.getState().clearedAt).toBeNull()
  })

  it('clearContext sets compactSummary to null', async () => {
    useChatStore.setState({ compactSummary: 'old summary' })
    await useChatStore.getState().clearContext(42)

    const state = useChatStore.getState()
    expect(state.compactSummary).toBeNull()
    expect(mockAgent.conversations.update).toHaveBeenCalledWith(42, expect.objectContaining({ compact_summary: null }))
  })

  it('compactContext sets isCompacting then resolves with summary', async () => {
    mockAgent.messages.compact.mockResolvedValueOnce({ summary: 'Compacted summary', clearedAt: '2025-06-01T00:00:00.000Z' })

    const promise = useChatStore.getState().compactContext(1)

    // isCompacting should be true immediately
    expect(useChatStore.getState().isCompacting).toBe(true)

    await promise

    const state = useChatStore.getState()
    expect(state.isCompacting).toBe(false)
    expect(state.compactSummary).toBe('Compacted summary')
    expect(state.clearedAt).toBe('2025-06-01T00:00:00.000Z')
    expect(mockAgent.messages.compact).toHaveBeenCalledWith(1)
  })

  it('compactContext sets compactSummary to null when summary is empty', async () => {
    mockAgent.messages.compact.mockResolvedValueOnce({ summary: '', clearedAt: '2025-06-01T00:00:00.000Z' })

    await useChatStore.getState().compactContext(1)

    const state = useChatStore.getState()
    expect(state.compactSummary).toBeNull()
    expect(state.isCompacting).toBe(false)
  })

  it('compactContext sets error on failure', async () => {
    mockAgent.messages.compact.mockRejectedValueOnce(new Error('Compact failed'))

    await useChatStore.getState().compactContext(1)

    const state = useChatStore.getState()
    expect(state.error).toBe('Compact failed')
    expect(state.isCompacting).toBe(false)
  })

  it('clearChat resets compactSummary and isCompacting', () => {
    useChatStore.setState({ compactSummary: 'some summary', isCompacting: true })
    useChatStore.getState().clearChat()

    const state = useChatStore.getState()
    expect(state.compactSummary).toBeNull()
    expect(state.isCompacting).toBe(false)
  })

  it('loadMessages extracts compactSummary from conversation', async () => {
    mockAgent.conversations.get.mockResolvedValueOnce({
      id: 1,
      title: 'Test',
      compact_summary: 'Loaded summary',
      messages: [],
    })

    await useChatStore.getState().loadMessages(1)

    expect(useChatStore.getState().compactSummary).toBe('Loaded summary')
  })

  it('loadMessages sets compactSummary to null when conversation has no compact_summary', async () => {
    useChatStore.setState({ compactSummary: 'stale summary' })
    mockAgent.conversations.get.mockResolvedValueOnce({
      id: 1,
      title: 'Test',
      messages: [],
    })

    await useChatStore.getState().loadMessages(1)

    expect(useChatStore.getState().compactSummary).toBeNull()
  })

  it('loadMessages extracts clearedAt from conversation', async () => {
    const clearedTs = '2024-06-15T12:00:00.000Z'
    mockAgent.conversations.get.mockResolvedValueOnce({
      id: 1,
      title: 'Test',
      cleared_at: clearedTs,
      messages: [],
    })

    await useChatStore.getState().loadMessages(1)

    expect(useChatStore.getState().clearedAt).toBe(clearedTs)
  })

  it('loadMessages sets clearedAt to null when conversation has no cleared_at', async () => {
    useChatStore.setState({ clearedAt: '2024-01-01T00:00:00.000Z' })
    mockAgent.conversations.get.mockResolvedValueOnce({
      id: 1,
      title: 'Test',
      messages: [],
    })

    await useChatStore.getState().loadMessages(1)

    expect(useChatStore.getState().clearedAt).toBeNull()
  })

  it('regenerateLastResponse removes last assistant message and sets isStreaming', async () => {
    useChatStore.setState({
      messages: [
        { id: 1, conversation_id: 1, role: 'user', content: 'Hi', attachments: '[]', created_at: '', updated_at: '' },
        { id: 2, conversation_id: 1, role: 'assistant', content: 'Hello!', attachments: '[]', created_at: '', updated_at: '' },
      ],
    })

    const promise = useChatStore.getState().regenerateLastResponse(1)

    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('user')
    expect(state.isStreaming).toBe(true)

    await promise
  })

  it('editMessage sets isStreaming', async () => {
    const promise = useChatStore.getState().editMessage(1, 'edited content')

    expect(useChatStore.getState().isStreaming).toBe(true)

    await promise
    expect(mockAgent.messages.edit).toHaveBeenCalledWith(1, 'edited content')
  })

  it('sendMessage handles error and sets error state', async () => {
    mockAgent.messages.send.mockRejectedValueOnce(new Error('Network error'))

    await useChatStore.getState().sendMessage(1, 'Hello')

    const state = useChatStore.getState()
    expect(state.error).toBe('Network error')
    expect(state.isStreaming).toBe(false)
  })

  it('sendMessage forwards attachments to IPC', async () => {
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

    const attachments = [
      { name: 'file.txt', path: '/tmp/file.txt', type: 'text/plain', size: 100 },
    ]
    await useChatStore.getState().sendMessage(1, 'With file', attachments)

    expect(mockAgent.messages.send).toHaveBeenCalledWith(1, 'With file', attachments)
  })

  it('sendMessage serializes attachments in optimistic message', async () => {
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

    const attachments = [{ name: 'a.txt', path: '/a.txt', type: 'text/plain', size: 10 }]
    const promise = useChatStore.getState().sendMessage(1, 'test', attachments)

    const state = useChatStore.getState()
    expect(JSON.parse(state.messages[0].attachments)).toEqual(attachments)

    await promise
  })

  it('regenerateLastResponse reloads messages after completion', async () => {
    const reloadedMsgs = [
      { id: 1, conversation_id: 1, role: 'user' as const, content: 'Hi', attachments: '[]', created_at: '', updated_at: '' },
      { id: 3, conversation_id: 1, role: 'assistant' as const, content: 'New response', attachments: '[]', created_at: '', updated_at: '' },
    ]
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: reloadedMsgs })

    useChatStore.setState({
      activeConversationId: 1,
      messages: [
        { id: 1, conversation_id: 1, role: 'user', content: 'Hi', attachments: '[]', created_at: '', updated_at: '' },
        { id: 2, conversation_id: 1, role: 'assistant', content: 'Old', attachments: '[]', created_at: '', updated_at: '' },
      ],
    })

    await useChatStore.getState().regenerateLastResponse(1)

    expect(mockAgent.messages.regenerate).toHaveBeenCalledWith(1)
    expect(mockAgent.conversations.get).toHaveBeenCalledWith(1)
  })

  it('editMessage reloads messages after completion when activeConversationId is set', async () => {
    const reloadedMsgs = [
      { id: 1, conversation_id: 1, role: 'user' as const, content: 'edited', attachments: '[]', created_at: '', updated_at: '' },
    ]
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: reloadedMsgs })

    useChatStore.setState({ activeConversationId: 1 })
    await useChatStore.getState().editMessage(1, 'edited')

    expect(mockAgent.messages.edit).toHaveBeenCalledWith(1, 'edited')
    expect(mockAgent.conversations.get).toHaveBeenCalledWith(1)
  })

  describe('stream listener', () => {
    it('drops text chunks from a conversation without a buffer', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({ type: 'text', content: 'leaked text', conversationId: 99 })

      const state = useChatStore.getState()
      expect(state.streamParts).toEqual([])
      expect(state.streamingContent).toBe('')
      expect(_streamBuffersMap.get(1)).toEqual([])
    })

    it('accepts text chunks matching an active buffer and updates buffer + view', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({ type: 'text', content: 'hello', conversationId: 1 })

      const state = useChatStore.getState()
      // View is synced because conv 1 is active
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamParts[0]).toEqual({ type: 'text', content: 'hello' })
      // Buffer matches view
      expect(_streamBuffersMap.get(1)).toHaveLength(1)
      expect(_streamBuffersMap.get(1)![0]).toEqual({ type: 'text', content: 'hello' })
    })

    it('accumulates chunks in buffer for background conv without updating view', () => {
      // User is on conv 2, but conv 1 is streaming in background
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 2, isStreaming: false })

      const listener = getStreamListener()
      listener({ type: 'text', content: 'background text', conversationId: 1 })
      listener({ type: 'tool_start', toolName: 'Bash', toolId: 't1', conversationId: 1 })

      const state = useChatStore.getState()
      // View is NOT updated (active conv is 2)
      expect(state.streamParts).toEqual([])
      expect(state.streamingContent).toBe('')
      // Buffer has the data
      expect(_streamBuffersMap.get(1)).toHaveLength(2)
      expect(_streamBuffersMap.get(1)![0]).toEqual({ type: 'text', content: 'background text' })
      expect(_streamBuffersMap.get(1)![1].type).toBe('tool')
    })

    it('accepts chunks without conversationId (backward compat, falls back to activeConversationId)', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({ type: 'text', content: 'legacy chunk' })

      const state = useChatStore.getState()
      expect(state.streamParts).toHaveLength(1)
      expect(_streamBuffersMap.get(1)).toHaveLength(1)
    })

    it('drops done event from a conversation without a buffer', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({ type: 'done', conversationId: 99 })

      // isStreaming should NOT be reset — the done was for a non-buffered conversation
      expect(useChatStore.getState().isStreaming).toBe(true)
    })

    it('drops error event from a conversation without a buffer', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({ type: 'error', content: 'something failed', conversationId: 99 })

      const state = useChatStore.getState()
      expect(state.isStreaming).toBe(true)
      expect(state.error).toBeNull()
    })

    it('drops tool_start from a conversation without a buffer', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({ type: 'tool_start', toolName: 'Bash', toolId: 't1', conversationId: 99 })

      expect(useChatStore.getState().streamParts).toEqual([])
    })

    it('tool_approval chunk creates tool_approval StreamPart in buffer and view', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({
        type: 'tool_approval',
        requestId: 'req_1',
        toolName: 'Bash',
        toolInput: JSON.stringify({ command: 'ls' }),
        conversationId: 1,
      })

      const state = useChatStore.getState()
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamParts[0]).toEqual({
        type: 'tool_approval',
        requestId: 'req_1',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
      })
      expect(_streamBuffersMap.get(1)).toHaveLength(1)
    })

    it('ask_user chunk creates ask_user StreamPart in buffer and view', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const questions = [
        { question: 'Which?', header: 'Choice', options: [{ label: 'A', description: 'Option A' }], multiSelect: false },
      ]
      const listener = getStreamListener()
      listener({
        type: 'ask_user',
        requestId: 'req_2',
        questions: JSON.stringify(questions),
        conversationId: 1,
      })

      const state = useChatStore.getState()
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamParts[0]).toEqual({
        type: 'ask_user',
        requestId: 'req_2',
        questions,
      })
      expect(_streamBuffersMap.get(1)).toHaveLength(1)
    })

    it('mcp_status chunk creates mcp_status StreamPart in buffer and view', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const servers = [
        { name: 'spotify', status: 'connected' },
        { name: 'github', status: 'error', error: 'binary not found' },
      ]
      const listener = getStreamListener()
      listener({
        type: 'mcp_status',
        mcpServers: JSON.stringify(servers),
        conversationId: 1,
      })

      const state = useChatStore.getState()
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamParts[0]).toEqual({
        type: 'mcp_status',
        servers,
      })
      expect(_streamBuffersMap.get(1)).toHaveLength(1)
    })

    it('mcp_status chunk with invalid JSON is ignored', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({
        type: 'mcp_status',
        mcpServers: '{invalid',
        conversationId: 1,
      })

      // Empty servers array → not pushed
      expect(useChatStore.getState().streamParts).toEqual([])
    })

    it('mcp_status chunk without mcpServers field is ignored', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({
        type: 'mcp_status',
        conversationId: 1,
      } as StreamChunk)

      expect(useChatStore.getState().streamParts).toEqual([])
    })

    it('drops tool_approval chunk from a conversation without a buffer', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({
        type: 'tool_approval',
        requestId: 'req_3',
        toolName: 'Write',
        toolInput: '{}',
        conversationId: 99,
      })

      expect(useChatStore.getState().streamParts).toEqual([])
    })

    it('system_message chunk creates system_message StreamPart in buffer and view', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({
        type: 'system_message',
        content: 'Hook says hello',
        hookName: 'pre-commit',
        hookEvent: 'PreToolUse',
        conversationId: 1,
      })

      const state = useChatStore.getState()
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamParts[0]).toEqual({
        type: 'system_message',
        content: 'Hook says hello',
        hookName: 'pre-commit',
        hookEvent: 'PreToolUse',
      })
      expect(_streamBuffersMap.get(1)).toHaveLength(1)
    })

    it('system_message chunk without content is ignored', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({
        type: 'system_message',
        conversationId: 1,
      } as StreamChunk)

      expect(useChatStore.getState().streamParts).toEqual([])
      expect(_streamBuffersMap.get(1)).toEqual([])
    })

    it('system_message chunk without hookName/hookEvent still works', () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({
        type: 'system_message',
        content: 'Just a message',
        conversationId: 1,
      })

      const state = useChatStore.getState()
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamParts[0]).toEqual({
        type: 'system_message',
        content: 'Just a message',
        hookName: undefined,
        hookEvent: undefined,
      })
    })

    it('isStreaming is cleared after sendMessage resolves even if done chunk was dropped', async () => {
      mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

      const promise = useChatStore.getState().sendMessage(1, 'Hello')

      // Simulate user switching conversations mid-stream via setActiveConversation
      useChatStore.getState().setActiveConversation(2)

      await promise

      // isStreaming should be false because setActiveConversation cleared it for the non-streaming conv
      expect(useChatStore.getState().isStreaming).toBe(false)
    })

    it('sendMessage resolving for background conversation does not clobber active state', async () => {
      mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

      const promise = useChatStore.getState().sendMessage(1, 'Hello')

      // User switches to conv 2 mid-stream
      useChatStore.getState().setActiveConversation(2)

      // Manually set some messages for conv 2 to simulate loaded state
      useChatStore.setState({
        messages: [{ id: 10, conversation_id: 2, role: 'user', content: 'Conv2 msg', attachments: '[]', created_at: '', updated_at: '' }],
      })

      await promise

      // Conv 2's messages should NOT be overwritten by conv 1's loadMessages
      const state = useChatStore.getState()
      expect(state.activeConversationId).toBe(2)
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].content).toBe('Conv2 msg')
    })

    it('done chunk removes buffer entry and clears isStreaming for active conv', () => {
      _streamBuffersMap.set(1, [{ type: 'text', content: 'data' }])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({ type: 'done', conversationId: 1 })

      const state = useChatStore.getState()
      expect(state.isStreaming).toBe(false)
      expect(_streamBuffersMap.has(1)).toBe(false)
    })

    it('error chunk removes buffer entry and sets error for active conv', () => {
      _streamBuffersMap.set(1, [{ type: 'text', content: 'data' }])
      useChatStore.setState({ activeConversationId: 1, isStreaming: true })

      const listener = getStreamListener()
      listener({ type: 'error', content: 'fail', conversationId: 1 })

      const state = useChatStore.getState()
      expect(state.isStreaming).toBe(false)
      expect(state.error).toBe('fail')
      expect(_streamBuffersMap.has(1)).toBe(false)
    })

    it('done for background conv removes its buffer but preserves isStreaming for active conv', () => {
      // Two conversations streaming simultaneously — view must match active buffer
      _streamBuffersMap.set(1, [{ type: 'text', content: 'active stream' }])
      _streamBuffersMap.set(2, [{ type: 'text', content: 'background stream' }])
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'text', content: 'active stream' }],
        streamingContent: 'active stream',
      })

      const listener = getStreamListener()
      listener({ type: 'done', conversationId: 2 })

      const state = useChatStore.getState()
      // Conv 1 is still streaming
      expect(state.isStreaming).toBe(true)
      expect(_streamBuffersMap.has(1)).toBe(true)
      // Conv 2 buffer removed
      expect(_streamBuffersMap.has(2)).toBe(false)
      // View unchanged (still shows conv 1)
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamParts[0]).toEqual({ type: 'text', content: 'active stream' })
    })

    it('two conversations stream simultaneously without interference', () => {
      // Both conv 1 and conv 2 have active buffers
      _streamBuffersMap.set(1, [])
      _streamBuffersMap.set(2, [])
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
      })

      const listener = getStreamListener()

      // Chunks arrive for both conversations
      listener({ type: 'text', content: 'conv1 text', conversationId: 1 })
      listener({ type: 'text', content: 'conv2 text', conversationId: 2 })
      listener({ type: 'tool_start', toolName: 'Bash', toolId: 't1', conversationId: 1 })
      listener({ type: 'tool_start', toolName: 'Read', toolId: 't2', conversationId: 2 })

      const state = useChatStore.getState()

      // Conv 1 (active) — view shows its parts
      expect(state.streamParts).toHaveLength(2)
      expect(state.streamParts[0]).toEqual({ type: 'text', content: 'conv1 text' })
      expect(state.streamParts[1].type).toBe('tool')

      // Both buffers have their own data
      expect(_streamBuffersMap.get(1)).toHaveLength(2)
      expect(_streamBuffersMap.get(2)).toHaveLength(2)
      expect(_streamBuffersMap.get(2)![0]).toEqual({ type: 'text', content: 'conv2 text' })
    })

    it('tool_input chunk attaches input to the running tool part', () => {
      _streamBuffersMap.set(1, [{ type: 'tool', name: 'Bash', id: 't1', status: 'running' }])
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'tool', name: 'Bash', id: 't1', status: 'running' }],
      })

      const listener = getStreamListener()
      listener({
        type: 'tool_input',
        toolId: 't1',
        toolInput: JSON.stringify({ command: 'npm test' }),
        conversationId: 1,
      })

      const state = useChatStore.getState()
      const toolPart = state.streamParts[0] as any
      expect(toolPart.type).toBe('tool')
      expect(toolPart.input).toEqual({ command: 'npm test' })
    })

    it('tool_input with invalid JSON is silently ignored', () => {
      _streamBuffersMap.set(1, [{ type: 'tool', name: 'Bash', id: 't1', status: 'running' }])
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'tool', name: 'Bash', id: 't1', status: 'running' }],
      })

      const listener = getStreamListener()
      listener({
        type: 'tool_input',
        toolId: 't1',
        toolInput: '{invalid json',
        conversationId: 1,
      })

      const state = useChatStore.getState()
      const toolPart = state.streamParts[0] as any
      expect(toolPart.input).toEqual({})
    })

    it('tool_result carries output data from enhanced chunk', () => {
      _streamBuffersMap.set(1, [{ type: 'tool', name: 'Bash', id: 't1', status: 'running' }])
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'tool', name: 'Bash', id: 't1', status: 'running' }],
      })

      const listener = getStreamListener()
      listener({
        type: 'tool_result',
        toolId: 't1',
        content: 'summary text',
        toolOutput: 'full output content here',
        toolInput: JSON.stringify({ command: 'npm test' }),
        conversationId: 1,
      } as StreamChunk)

      const state = useChatStore.getState()
      const toolPart = state.streamParts[0] as any
      expect(toolPart.status).toBe('done')
      expect(toolPart.summary).toBe('summary text')
      expect(toolPart.output).toBe('full output content here')
      expect(toolPart.input).toEqual({ command: 'npm test' })
    })

    it('tool_result without toolOutput falls back to content for output', () => {
      _streamBuffersMap.set(1, [{ type: 'tool', name: 'Read', id: 't2', status: 'running' }])
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'tool', name: 'Read', id: 't2', status: 'running' }],
      })

      const listener = getStreamListener()
      listener({
        type: 'tool_result',
        toolId: 't2',
        content: 'file contents',
        conversationId: 1,
      })

      const state = useChatStore.getState()
      const toolPart = state.streamParts[0] as any
      expect(toolPart.output).toBe('file contents')
    })
  })

  describe('onConversationUpdated listener', () => {
    function getListener(): (conversationId: number) => void {
      if (!capturedConversationUpdatedListener) throw new Error('Conversation updated listener was not captured')
      return capturedConversationUpdatedListener
    }

    it('reloads messages when viewing the updated conversation and not streaming it', async () => {
      const reloadedMsgs = [
        { id: 1, conversation_id: 5, role: 'user' as const, content: 'Hi', attachments: '[]', created_at: '', updated_at: '' },
        { id: 2, conversation_id: 5, role: 'assistant' as const, content: 'Hello!', attachments: '[]', created_at: '', updated_at: '' },
      ]
      mockAgent.conversations.get.mockResolvedValueOnce({ id: 5, title: 'Test', messages: reloadedMsgs })

      useChatStore.setState({ activeConversationId: 5 })

      getListener()(5)

      // Wait for async loadMessages
      await new Promise(r => setTimeout(r, 50))
      expect(mockAgent.conversations.get).toHaveBeenCalledWith(5)
    })

    it('does not reload when viewing a different conversation', () => {
      useChatStore.setState({ activeConversationId: 3 })

      getListener()(5)

      expect(mockAgent.conversations.get).not.toHaveBeenCalled()
    })

    it('does not reload when the conversation is currently streaming (has buffer)', () => {
      _streamBuffersMap.set(5, [])
      useChatStore.setState({ activeConversationId: 5 })

      getListener()(5)

      expect(mockAgent.conversations.get).not.toHaveBeenCalled()
    })
  })

  describe('setActiveConversation', () => {
    it('shows empty view when switching away from streaming conversation', () => {
      _streamBuffersMap.set(1, [{ type: 'text', content: 'partial' }])
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'text', content: 'partial' }],
        streamingContent: 'partial',
      })

      useChatStore.getState().setActiveConversation(2)

      const state = useChatStore.getState()
      expect(state.activeConversationId).toBe(2)
      expect(state.isStreaming).toBe(false)
      // View is empty (conv 2 has no buffer)
      expect(state.streamParts).toEqual([])
      expect(state.streamingContent).toBe('')
      // Buffer for conv 1 is preserved
      expect(_streamBuffersMap.get(1)).toEqual([{ type: 'text', content: 'partial' }])
    })

    it('restores isStreaming and view from buffer when switching back', () => {
      _streamBuffersMap.set(1, [{ type: 'text', content: 'accumulated' }])
      _streamTextMap.set(1, 'accumulated')
      useChatStore.setState({
        activeConversationId: 2,
        isStreaming: false,
        streamParts: [],
        streamingContent: '',
      })

      useChatStore.getState().setActiveConversation(1)

      const state = useChatStore.getState()
      expect(state.activeConversationId).toBe(1)
      expect(state.isStreaming).toBe(true)
      // View restored from buffer
      expect(state.streamParts).toEqual([{ type: 'text', content: 'accumulated' }])
      expect(state.streamingContent).toBe('accumulated')
    })

    it('full round-trip: switch away, chunks accumulate in buffer, switch back shows all', () => {
      // 1. Streaming on conv 1
      _streamBuffersMap.set(1, [{ type: 'text', content: 'before ' }])
      _streamTextMap.set(1, 'before ')
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'text', content: 'before ' }],
        streamingContent: 'before ',
      })

      // 2. Switch to conv 2
      useChatStore.getState().setActiveConversation(2)
      expect(useChatStore.getState().isStreaming).toBe(false)
      expect(useChatStore.getState().streamParts).toEqual([]) // view is empty

      // 3. Chunks arrive for conv 1 while on conv 2
      const listener = getStreamListener()
      listener({ type: 'text', content: 'during ', conversationId: 1 })
      listener({ type: 'tool_start', toolName: 'Read', toolId: 't1', conversationId: 1 })
      listener({ type: 'tool_result', toolId: 't1', content: 'file.ts', conversationId: 1 })

      // View is still empty (we're on conv 2)
      expect(useChatStore.getState().streamParts).toEqual([])
      // But buffer has everything
      expect(_streamBuffersMap.get(1)).toHaveLength(2)

      // 4. Switch back to conv 1
      useChatStore.getState().setActiveConversation(1)

      const state = useChatStore.getState()
      expect(state.isStreaming).toBe(true)
      // View restored from buffer: text merged + tool done
      expect(state.streamParts).toHaveLength(2)
      expect(state.streamParts[0]).toEqual({ type: 'text', content: 'before during ' })
      expect(state.streamParts[1].type).toBe('tool')
      expect((state.streamParts[1] as any).status).toBe('done')
    })

    it('clears view when no active stream and switching conversations', () => {
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: false,
        streamParts: [{ type: 'text', content: 'stale' }],
        streamingContent: 'stale',
      })

      useChatStore.getState().setActiveConversation(2)

      const state = useChatStore.getState()
      expect(state.streamParts).toEqual([])
      expect(state.streamingContent).toBe('')
    })

    it('shows empty view when switching to null during active stream', () => {
      _streamBuffersMap.set(1, [{ type: 'text', content: 'keep' }])
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'text', content: 'keep' }],
      })

      useChatStore.getState().setActiveConversation(null)

      const state = useChatStore.getState()
      expect(state.activeConversationId).toBeNull()
      expect(state.isStreaming).toBe(false)
      // View is empty (null conv has no buffer)
      expect(state.streamParts).toEqual([])
      // Buffer is preserved
      expect(_streamBuffersMap.get(1)).toEqual([{ type: 'text', content: 'keep' }])
    })

    it('switches between two streaming conversations correctly', () => {
      // Both conv 1 and 2 are streaming
      _streamBuffersMap.set(1, [{ type: 'text', content: 'conv1 data' }])
      _streamBuffersMap.set(2, [{ type: 'text', content: 'conv2 data' }])
      _streamTextMap.set(1, 'conv1 data')
      _streamTextMap.set(2, 'conv2 data')
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'text', content: 'conv1 data' }],
        streamingContent: 'conv1 data',
      })

      // Switch to conv 2
      useChatStore.getState().setActiveConversation(2)

      let state = useChatStore.getState()
      expect(state.isStreaming).toBe(true) // conv 2 is also streaming
      expect(state.streamParts).toEqual([{ type: 'text', content: 'conv2 data' }])
      expect(state.streamingContent).toBe('conv2 data')

      // Switch back to conv 1
      useChatStore.getState().setActiveConversation(1)

      state = useChatStore.getState()
      expect(state.isStreaming).toBe(true)
      expect(state.streamParts).toEqual([{ type: 'text', content: 'conv1 data' }])
      expect(state.streamingContent).toBe('conv1 data')
    })
  })

  describe('notification events', () => {
    const listener = () => getStreamListener()

    beforeEach(() => {
      vi.mocked(playCompletionSound).mockClear()
      vi.mocked(playErrorSound).mockClear()
      mockAgent.system.showNotification.mockClear()
      // Set master toggle ON with default config
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(DEFAULT_NOTIFICATION_CONFIG),
        },
      })
      _streamBuffersMap.set(1, [{ type: 'text', content: 'data' }])
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
      })
    })

    it('plays completion sound for success event', () => {
      listener()({ type: 'done', conversationId: 1 })
      expect(playCompletionSound).toHaveBeenCalledTimes(1)
      expect(playErrorSound).not.toHaveBeenCalled()
    })

    it('plays error sound for error_max_turns event', () => {
      listener()({ type: 'done', conversationId: 1, resultSubtype: 'error_max_turns' })
      expect(playErrorSound).toHaveBeenCalledTimes(1)
      expect(playCompletionSound).not.toHaveBeenCalled()
    })

    it('plays error sound for refusal event', () => {
      listener()({ type: 'done', conversationId: 1, stopReason: 'refusal' })
      expect(playErrorSound).toHaveBeenCalledTimes(1)
      expect(playCompletionSound).not.toHaveBeenCalled()
    })

    it('plays error sound for max_tokens event', () => {
      listener()({ type: 'done', conversationId: 1, stopReason: 'max_tokens' })
      expect(playErrorSound).toHaveBeenCalledTimes(1)
    })

    it('plays error sound for error_js event on error chunk', () => {
      listener()({ type: 'error', content: 'Something broke', conversationId: 1 })
      expect(playErrorSound).toHaveBeenCalledTimes(1)
    })

    it('does not play sound when event has sound: false', () => {
      const config = { ...DEFAULT_NOTIFICATION_CONFIG, success: { sound: false, desktop: false } }
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(config),
        },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(playCompletionSound).not.toHaveBeenCalled()
      expect(playErrorSound).not.toHaveBeenCalled()
    })

    it('does not play any sound for aborted streams', () => {
      listener()({ type: 'done', conversationId: 1, stopReason: 'aborted' })
      expect(playCompletionSound).not.toHaveBeenCalled()
      expect(playErrorSound).not.toHaveBeenCalled()
    })

    it('master toggle OFF disables all notifications', () => {
      useSettingsStore.setState({
        settings: { notificationSounds: 'false' },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(playCompletionSound).not.toHaveBeenCalled()
      expect(playErrorSound).not.toHaveBeenCalled()
    })

    it('master toggle OFF disables error notifications too', () => {
      useSettingsStore.setState({
        settings: { notificationSounds: 'false' },
      })

      listener()({ type: 'error', content: 'fail', conversationId: 1 })
      expect(playErrorSound).not.toHaveBeenCalled()
    })

    it('shows desktop notification when document is hidden and desktop: true (hidden mode)', () => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true })
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(DEFAULT_NOTIFICATION_CONFIG),
          notificationDesktopMode: 'hidden',
        },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(mockAgent.system.showNotification).toHaveBeenCalledWith('Agent Desktop', 'Completed')

      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
    })

    it('does not show desktop notification when document is visible (hidden mode)', () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(DEFAULT_NOTIFICATION_CONFIG),
          notificationDesktopMode: 'hidden',
        },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(mockAgent.system.showNotification).not.toHaveBeenCalled()
    })

    it('shows desktop notification when window lacks focus (unfocused mode)', () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
      const originalHasFocus = document.hasFocus
      document.hasFocus = () => false
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(DEFAULT_NOTIFICATION_CONFIG),
          notificationDesktopMode: 'unfocused',
        },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(mockAgent.system.showNotification).toHaveBeenCalledWith('Agent Desktop', 'Completed')

      document.hasFocus = originalHasFocus
    })

    it('does not show desktop notification when window has focus (unfocused mode)', () => {
      const originalHasFocus = document.hasFocus
      document.hasFocus = () => true
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(DEFAULT_NOTIFICATION_CONFIG),
          notificationDesktopMode: 'unfocused',
        },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(mockAgent.system.showNotification).not.toHaveBeenCalled()

      document.hasFocus = originalHasFocus
    })

    it('always shows desktop notification in always mode', () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
      const originalHasFocus = document.hasFocus
      document.hasFocus = () => true
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(DEFAULT_NOTIFICATION_CONFIG),
          notificationDesktopMode: 'always',
        },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(mockAgent.system.showNotification).toHaveBeenCalledWith('Agent Desktop', 'Completed')

      document.hasFocus = originalHasFocus
    })

    it('defaults to unfocused mode when notificationDesktopMode setting is absent', () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
      const originalHasFocus = document.hasFocus
      document.hasFocus = () => false
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(DEFAULT_NOTIFICATION_CONFIG),
        },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(mockAgent.system.showNotification).toHaveBeenCalledWith('Agent Desktop', 'Completed')

      document.hasFocus = originalHasFocus
    })

    it('does not show desktop notification when desktop: false for error_js', () => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true })
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(DEFAULT_NOTIFICATION_CONFIG),
          notificationDesktopMode: 'hidden',
        },
      })

      // error_js has desktop: false by default
      listener()({ type: 'error', content: 'crash', conversationId: 1 })
      expect(mockAgent.system.showNotification).not.toHaveBeenCalled()

      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
    })

    it('error handler respects always mode', () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
      const originalHasFocus = document.hasFocus
      document.hasFocus = () => true
      // Enable desktop for error_js
      const config = { ...DEFAULT_NOTIFICATION_CONFIG, error_js: { sound: true, desktop: true } }
      useSettingsStore.setState({
        settings: {
          notificationSounds: 'true',
          notificationConfig: JSON.stringify(config),
          notificationDesktopMode: 'always',
        },
      })

      listener()({ type: 'error', content: 'crash', conversationId: 1 })
      expect(mockAgent.system.showNotification).toHaveBeenCalledWith('Agent Desktop', 'System error')

      document.hasFocus = originalHasFocus
    })

    it('falls back to DEFAULT_NOTIFICATION_CONFIG when notificationConfig is missing', () => {
      useSettingsStore.setState({
        settings: { notificationSounds: 'true' },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(playCompletionSound).toHaveBeenCalledTimes(1)
    })

    it('falls back to DEFAULT_NOTIFICATION_CONFIG when notificationConfig is invalid JSON', () => {
      useSettingsStore.setState({
        settings: { notificationSounds: 'true', notificationConfig: '{broken' },
      })

      listener()({ type: 'done', conversationId: 1 })
      expect(playCompletionSound).toHaveBeenCalledTimes(1)
    })
  })

  describe('message queue', () => {
    it('addToQueue pushes message to messageQueues for conversation', () => {
      useChatStore.getState().addToQueue(1, 'test message')

      const state = useChatStore.getState()
      expect(state.messageQueues[1]).toHaveLength(1)
      expect(state.messageQueues[1][0].content).toBe('test message')
      expect(state.messageQueues[1][0].id).toBeDefined()
    })

    it('addToQueue appends to existing queue', () => {
      useChatStore.getState().addToQueue(1, 'first')
      useChatStore.getState().addToQueue(1, 'second')

      expect(useChatStore.getState().messageQueues[1]).toHaveLength(2)
      expect(useChatStore.getState().messageQueues[1][1].content).toBe('second')
    })

    it('addToQueue keeps separate queues per conversation', () => {
      useChatStore.getState().addToQueue(1, 'conv1')
      useChatStore.getState().addToQueue(2, 'conv2')

      expect(useChatStore.getState().messageQueues[1]).toHaveLength(1)
      expect(useChatStore.getState().messageQueues[2]).toHaveLength(1)
    })

    it('removeFromQueue removes by id', () => {
      useChatStore.getState().addToQueue(1, 'keep')
      useChatStore.getState().addToQueue(1, 'remove')
      const id = useChatStore.getState().messageQueues[1][1].id
      useChatStore.getState().removeFromQueue(1, id)

      expect(useChatStore.getState().messageQueues[1]).toHaveLength(1)
      expect(useChatStore.getState().messageQueues[1][0].content).toBe('keep')
    })

    it('editQueuedMessage updates content in place', () => {
      useChatStore.getState().addToQueue(1, 'original')
      const id = useChatStore.getState().messageQueues[1][0].id
      useChatStore.getState().editQueuedMessage(1, id, 'edited')

      expect(useChatStore.getState().messageQueues[1][0].content).toBe('edited')
    })

    it('reorderQueue moves item from one index to another', () => {
      useChatStore.getState().addToQueue(1, 'A')
      useChatStore.getState().addToQueue(1, 'B')
      useChatStore.getState().addToQueue(1, 'C')
      useChatStore.getState().reorderQueue(1, 2, 0) // move C to front

      const q = useChatStore.getState().messageQueues[1]
      expect(q.map((m) => m.content)).toEqual(['C', 'A', 'B'])
    })

    it('clearQueue removes all messages for conversation', () => {
      useChatStore.getState().addToQueue(1, 'a')
      useChatStore.getState().addToQueue(1, 'b')
      useChatStore.getState().clearQueue(1)

      expect(useChatStore.getState().messageQueues[1]).toBeUndefined()
    })

    it('pauseQueue sets queuePaused for conversation', () => {
      useChatStore.getState().pauseQueue(1)
      expect(useChatStore.getState().queuePaused[1]).toBe(true)
    })

    it('resumeQueue sets queuePaused false', () => {
      useChatStore.getState().pauseQueue(1)
      useChatStore.getState().resumeQueue(1)
      expect(useChatStore.getState().queuePaused[1]).toBeFalsy()
    })

    it('lockQueueForEdit sets queueEditLocked for conversation', () => {
      useChatStore.getState().lockQueueForEdit(1)
      expect(useChatStore.getState().queueEditLocked[1]).toBe(true)
    })

    it('unlockQueueForEdit clears queueEditLocked for conversation', () => {
      useChatStore.getState().lockQueueForEdit(1)
      useChatStore.getState().unlockQueueForEdit(1)
      expect(useChatStore.getState().queueEditLocked[1]).toBeFalsy()
    })

    it('popQueue returns null when queueEditLocked', async () => {
      useChatStore.setState({
        activeConversationId: 1,
        messageQueues: { 1: [{ id: 'q1', content: 'queued', createdAt: Date.now() }] },
        queueEditLocked: { 1: true },
      })

      mockAgent.messages.send.mockResolvedValueOnce({ id: 2, role: 'assistant', content: 'done' })
      mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

      await useChatStore.getState().sendMessage(1, 'first')

      // Queue should remain since edit-locked
      expect(useChatStore.getState().messageQueues[1]).toHaveLength(1)
    })

    it('clearQueue also clears queueEditLocked', () => {
      useChatStore.getState().addToQueue(1, 'msg')
      useChatStore.getState().lockQueueForEdit(1)
      useChatStore.getState().clearQueue(1)

      expect(useChatStore.getState().queueEditLocked[1]).toBeUndefined()
    })

    it('streamOperation drains queue after stream completes', async () => {
      _streamBuffersMap.set(1, [])
      useChatStore.setState({
        activeConversationId: 1,
        messageQueues: { 1: [{ id: 'q1', content: 'queued msg', createdAt: Date.now() }] },
        queuePaused: {},
      })

      // First send resolves (the initial message)
      mockAgent.messages.send.mockResolvedValueOnce({ id: 2, role: 'assistant', content: 'done' })
      mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

      // Second send resolves (the queued message drained)
      mockAgent.messages.send.mockResolvedValueOnce({ id: 3, role: 'assistant', content: 'queued reply' })
      mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

      await useChatStore.getState().sendMessage(1, 'first msg')

      // Queue should be drained
      expect(useChatStore.getState().messageQueues[1] || []).toHaveLength(0)
    })

    it('streamOperation does NOT drain queue when paused', async () => {
      useChatStore.setState({
        activeConversationId: 1,
        messageQueues: { 1: [{ id: 'q1', content: 'queued', createdAt: Date.now() }] },
        queuePaused: { 1: true },
      })

      mockAgent.messages.send.mockResolvedValueOnce({ id: 2, role: 'assistant', content: 'done' })
      mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

      await useChatStore.getState().sendMessage(1, 'first')

      // Queue should remain since paused
      expect(useChatStore.getState().messageQueues[1]).toHaveLength(1)
    })

    it('stopGeneration pauses the queue', async () => {
      useChatStore.setState({
        activeConversationId: 1,
        messageQueues: { 1: [{ id: 'q1', content: 'queued', createdAt: Date.now() }] },
      })
      mockAgent.messages.stop.mockResolvedValueOnce(undefined)

      await useChatStore.getState().stopGeneration()

      expect(useChatStore.getState().queuePaused[1]).toBe(true)
    })

    it('regenerateLastResponse pauses the queue', async () => {
      useChatStore.setState({
        activeConversationId: 1,
        messages: [{ id: 1, role: 'assistant', content: 'hi', conversation_id: 1, created_at: '', updated_at: '' }],
        messageQueues: { 1: [{ id: 'q1', content: 'queued', createdAt: Date.now() }] },
      })
      mockAgent.messages.regenerate.mockResolvedValueOnce({})
      mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, messages: [] })

      await useChatStore.getState().regenerateLastResponse(1)

      expect(useChatStore.getState().queuePaused[1]).toBe(true)
    })

    it('editMessage pauses the queue', async () => {
      useChatStore.setState({
        activeConversationId: 1,
        messages: [{ id: 10, role: 'user', content: 'orig', conversation_id: 1, created_at: '', updated_at: '' }],
        messageQueues: { 1: [{ id: 'q1', content: 'queued', createdAt: Date.now() }] },
      })
      mockAgent.messages.edit.mockResolvedValueOnce({})
      mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, messages: [] })

      await useChatStore.getState().editMessage(10, 'edited')

      expect(useChatStore.getState().queuePaused[1]).toBe(true)
    })

    it('stream error pauses the queue', async () => {
      useChatStore.setState({
        activeConversationId: 1,
        messageQueues: { 1: [{ id: 'q1', content: 'queued', createdAt: Date.now() }] },
        queuePaused: {},
      })

      mockAgent.messages.send.mockRejectedValueOnce(new Error('stream failed'))

      await useChatStore.getState().sendMessage(1, 'first')

      expect(useChatStore.getState().queuePaused[1]).toBe(true)
    })

    it('resumeQueue sends next queued message if not streaming', async () => {
      vi.useFakeTimers()
      try {
        // _streamBuffersMap already clear from beforeEach — NOT streaming
        useChatStore.setState({
          activeConversationId: 1,
          messageQueues: { 1: [{ id: 'q1', content: 'queued msg', createdAt: Date.now() }] },
          queuePaused: { 1: true },
        })

        mockAgent.messages.send.mockResolvedValueOnce({ id: 2, role: 'assistant', content: 'reply' })
        mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, messages: [] })

        useChatStore.getState().resumeQueue(1)

        expect(useChatStore.getState().queuePaused[1]).toBeFalsy()

        // Advance past the random delay (max 5s)
        await vi.advanceTimersByTimeAsync(5000)

        // Queue should have been drained
        expect(useChatStore.getState().messageQueues[1] || []).toHaveLength(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('resumeQueue does not send if currently streaming', () => {
      _streamBuffersMap.set(1, [])  // currently streaming
      useChatStore.setState({
        activeConversationId: 1,
        messageQueues: { 1: [{ id: 'q1', content: 'queued', createdAt: Date.now() }] },
        queuePaused: { 1: true },
      })

      useChatStore.getState().resumeQueue(1)

      // Queue should remain — drain will happen after current stream via streamOperation
      expect(useChatStore.getState().messageQueues[1]).toHaveLength(1)
      expect(useChatStore.getState().queuePaused[1]).toBeFalsy()
    })
  })
})
