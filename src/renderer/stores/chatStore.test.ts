import { mockAgent, capturedStreamListener } from '../__tests__/setup'
import { useChatStore } from './chatStore'
import type { StreamChunk } from '../../shared/types'

function getStreamListener(): (chunk: StreamChunk) => void {
  if (!capturedStreamListener) throw new Error('Stream listener was not captured — chatStore module did not register onStream')
  return capturedStreamListener as (chunk: StreamChunk) => void
}

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    streamParts: [],
    streamingContent: '',
    streamBuffers: {},
    isLoading: false,
    error: null,
    activeConversationId: null,
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
    const state = useChatStore.getState()
    expect(state.streamBuffers).toHaveProperty('1')
    expect(state.streamBuffers[1]).toEqual([])

    await promise
  })

  it('sendMessage cleans up streamBuffers entry after completion', async () => {
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

    await useChatStore.getState().sendMessage(1, 'Hello')

    expect(useChatStore.getState().streamBuffers).not.toHaveProperty('1')
  })

  it('stopGeneration calls window.agent.messages.stop', async () => {
    await useChatStore.getState().stopGeneration()
    expect(mockAgent.messages.stop).toHaveBeenCalled()
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
    useChatStore.setState({
      messages: [{ id: 1, conversation_id: 1, role: 'user', content: 'x', attachments: '[]', created_at: '', updated_at: '' }],
      isStreaming: true,
      error: 'some error',
      activeConversationId: 1,
      streamBuffers: { 1: [{ type: 'text', content: 'data' }] },
    })

    useChatStore.getState().clearChat()

    const state = useChatStore.getState()
    expect(state.messages).toEqual([])
    expect(state.isStreaming).toBe(false)
    expect(state.error).toBeNull()
    expect(state.activeConversationId).toBeNull()
    expect(state.streamBuffers).toEqual({})
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
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

      const listener = getStreamListener()
      listener({ type: 'text', content: 'leaked text', conversationId: 99 })

      const state = useChatStore.getState()
      expect(state.streamParts).toEqual([])
      expect(state.streamingContent).toBe('')
      expect(state.streamBuffers[1]).toEqual([])
    })

    it('accepts text chunks matching an active buffer and updates buffer + view', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

      const listener = getStreamListener()
      listener({ type: 'text', content: 'hello', conversationId: 1 })

      const state = useChatStore.getState()
      // View is synced because conv 1 is active
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamParts[0]).toEqual({ type: 'text', content: 'hello' })
      // Buffer matches view
      expect(state.streamBuffers[1]).toHaveLength(1)
      expect(state.streamBuffers[1][0]).toEqual({ type: 'text', content: 'hello' })
    })

    it('accumulates chunks in buffer for background conv without updating view', () => {
      // User is on conv 2, but conv 1 is streaming in background
      useChatStore.setState({ activeConversationId: 2, isStreaming: false, streamBuffers: { 1: [] } })

      const listener = getStreamListener()
      listener({ type: 'text', content: 'background text', conversationId: 1 })
      listener({ type: 'tool_start', toolName: 'Bash', toolId: 't1', conversationId: 1 })

      const state = useChatStore.getState()
      // View is NOT updated (active conv is 2)
      expect(state.streamParts).toEqual([])
      expect(state.streamingContent).toBe('')
      // Buffer has the data
      expect(state.streamBuffers[1]).toHaveLength(2)
      expect(state.streamBuffers[1][0]).toEqual({ type: 'text', content: 'background text' })
      expect(state.streamBuffers[1][1].type).toBe('tool')
    })

    it('accepts chunks without conversationId (backward compat, falls back to activeConversationId)', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

      const listener = getStreamListener()
      listener({ type: 'text', content: 'legacy chunk' })

      const state = useChatStore.getState()
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamBuffers[1]).toHaveLength(1)
    })

    it('drops done event from a conversation without a buffer', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

      const listener = getStreamListener()
      listener({ type: 'done', conversationId: 99 })

      // isStreaming should NOT be reset — the done was for a non-buffered conversation
      expect(useChatStore.getState().isStreaming).toBe(true)
    })

    it('drops error event from a conversation without a buffer', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

      const listener = getStreamListener()
      listener({ type: 'error', content: 'something failed', conversationId: 99 })

      const state = useChatStore.getState()
      expect(state.isStreaming).toBe(true)
      expect(state.error).toBeNull()
    })

    it('drops tool_start from a conversation without a buffer', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

      const listener = getStreamListener()
      listener({ type: 'tool_start', toolName: 'Bash', toolId: 't1', conversationId: 99 })

      expect(useChatStore.getState().streamParts).toEqual([])
    })

    it('tool_approval chunk creates tool_approval StreamPart in buffer and view', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

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
      expect(state.streamBuffers[1]).toHaveLength(1)
    })

    it('ask_user chunk creates ask_user StreamPart in buffer and view', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

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
      expect(state.streamBuffers[1]).toHaveLength(1)
    })

    it('mcp_status chunk creates mcp_status StreamPart in buffer and view', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

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
      expect(state.streamBuffers[1]).toHaveLength(1)
    })

    it('mcp_status chunk with invalid JSON is ignored', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

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
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

      const listener = getStreamListener()
      listener({
        type: 'mcp_status',
        conversationId: 1,
      } as StreamChunk)

      expect(useChatStore.getState().streamParts).toEqual([])
    })

    it('drops tool_approval chunk from a conversation without a buffer', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [] } })

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
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [{ type: 'text', content: 'data' }] } })

      const listener = getStreamListener()
      listener({ type: 'done', conversationId: 1 })

      const state = useChatStore.getState()
      expect(state.isStreaming).toBe(false)
      expect(state.streamBuffers).not.toHaveProperty('1')
    })

    it('error chunk removes buffer entry and sets error for active conv', () => {
      useChatStore.setState({ activeConversationId: 1, isStreaming: true, streamBuffers: { 1: [{ type: 'text', content: 'data' }] } })

      const listener = getStreamListener()
      listener({ type: 'error', content: 'fail', conversationId: 1 })

      const state = useChatStore.getState()
      expect(state.isStreaming).toBe(false)
      expect(state.error).toBe('fail')
      expect(state.streamBuffers).not.toHaveProperty('1')
    })

    it('done for background conv removes its buffer but preserves isStreaming for active conv', () => {
      // Two conversations streaming simultaneously — view must match active buffer
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'text', content: 'active stream' }],
        streamingContent: 'active stream',
        streamBuffers: {
          1: [{ type: 'text', content: 'active stream' }],
          2: [{ type: 'text', content: 'background stream' }],
        },
      })

      const listener = getStreamListener()
      listener({ type: 'done', conversationId: 2 })

      const state = useChatStore.getState()
      // Conv 1 is still streaming
      expect(state.isStreaming).toBe(true)
      expect(state.streamBuffers).toHaveProperty('1')
      // Conv 2 buffer removed
      expect(state.streamBuffers).not.toHaveProperty('2')
      // View unchanged (still shows conv 1)
      expect(state.streamParts).toHaveLength(1)
      expect(state.streamParts[0]).toEqual({ type: 'text', content: 'active stream' })
    })

    it('two conversations stream simultaneously without interference', () => {
      // Both conv 1 and conv 2 have active buffers
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamBuffers: { 1: [], 2: [] },
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
      expect(state.streamBuffers[1]).toHaveLength(2)
      expect(state.streamBuffers[2]).toHaveLength(2)
      expect(state.streamBuffers[2][0]).toEqual({ type: 'text', content: 'conv2 text' })
    })

    it('tool_input chunk attaches input to the running tool part', () => {
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamBuffers: { 1: [{ type: 'tool', name: 'Bash', id: 't1', status: 'running' }] },
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
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamBuffers: { 1: [{ type: 'tool', name: 'Bash', id: 't1', status: 'running' }] },
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
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamBuffers: { 1: [{ type: 'tool', name: 'Bash', id: 't1', status: 'running' }] },
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
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamBuffers: { 1: [{ type: 'tool', name: 'Read', id: 't2', status: 'running' }] },
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

  describe('setActiveConversation', () => {
    it('shows empty view when switching away from streaming conversation', () => {
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'text', content: 'partial' }],
        streamingContent: 'partial',
        streamBuffers: { 1: [{ type: 'text', content: 'partial' }] },
      })

      useChatStore.getState().setActiveConversation(2)

      const state = useChatStore.getState()
      expect(state.activeConversationId).toBe(2)
      expect(state.isStreaming).toBe(false)
      // View is empty (conv 2 has no buffer)
      expect(state.streamParts).toEqual([])
      expect(state.streamingContent).toBe('')
      // Buffer for conv 1 is preserved
      expect(state.streamBuffers[1]).toEqual([{ type: 'text', content: 'partial' }])
    })

    it('restores isStreaming and view from buffer when switching back', () => {
      useChatStore.setState({
        activeConversationId: 2,
        isStreaming: false,
        streamParts: [],
        streamingContent: '',
        streamBuffers: { 1: [{ type: 'text', content: 'accumulated' }] },
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
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'text', content: 'before ' }],
        streamingContent: 'before ',
        streamBuffers: { 1: [{ type: 'text', content: 'before ' }] },
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
      expect(useChatStore.getState().streamBuffers[1]).toHaveLength(2)

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
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamParts: [{ type: 'text', content: 'keep' }],
        streamBuffers: { 1: [{ type: 'text', content: 'keep' }] },
      })

      useChatStore.getState().setActiveConversation(null)

      const state = useChatStore.getState()
      expect(state.activeConversationId).toBeNull()
      expect(state.isStreaming).toBe(false)
      // View is empty (null conv has no buffer)
      expect(state.streamParts).toEqual([])
      // Buffer is preserved
      expect(state.streamBuffers[1]).toEqual([{ type: 'text', content: 'keep' }])
    })

    it('switches between two streaming conversations correctly', () => {
      // Both conv 1 and 2 are streaming
      useChatStore.setState({
        activeConversationId: 1,
        isStreaming: true,
        streamBuffers: {
          1: [{ type: 'text', content: 'conv1 data' }],
          2: [{ type: 'text', content: 'conv2 data' }],
        },
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
})
