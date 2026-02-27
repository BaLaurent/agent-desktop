# Message Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add sequential message queuing so users can send messages while the AI streams, with an editable queue panel (reorder, edit, delete).

**Architecture:** Renderer-only queue in `chatStore.ts` Zustand store. Per-conversation `messageQueues` and `queuePaused` dicts (same keying pattern as `streamBuffers`). New `QueuePanel` component rendered between chat and input in `ChatView.tsx`. Zero main process changes.

**Tech Stack:** React, Zustand, Tailwind CSS, Vitest + @testing-library/react

---

### Task 1: Add queue state and actions to chatStore

**Files:**
- Modify: `src/renderer/stores/chatStore.ts:7-29` (ChatState interface)
- Modify: `src/renderer/stores/chatStore.ts:112-122` (initial state)
- Modify: `src/renderer/stores/chatStore.ts` (add actions after `compactContext`)
- Test: `src/renderer/stores/chatStore.test.ts`

**Step 1: Write the failing tests**

Add to `src/renderer/stores/chatStore.test.ts`:

```typescript
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
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/stores/chatStore.test.ts --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — `addToQueue` not a function

**Step 3: Add QueuedMessage type and state to ChatState interface**

In `src/renderer/stores/chatStore.ts`, add the `QueuedMessage` interface before `ChatState` (around line 5):

```typescript
export interface QueuedMessage {
  id: string
  content: string
  attachments?: Attachment[]
  createdAt: number
}
```

Extend `ChatState` interface (lines 7-29) — add after `activeConversationId`:

```typescript
  messageQueues: Record<number, QueuedMessage[]>
  queuePaused: Record<number, boolean>

  addToQueue: (conversationId: number, content: string, attachments?: Attachment[]) => void
  removeFromQueue: (conversationId: number, messageId: string) => void
  editQueuedMessage: (conversationId: number, messageId: string, newContent: string) => void
  reorderQueue: (conversationId: number, fromIndex: number, toIndex: number) => void
  clearQueue: (conversationId: number) => void
  pauseQueue: (conversationId: number) => void
  resumeQueue: (conversationId: number) => void
```

Add initial state values (after `activeConversationId: null` around line 122):

```typescript
  messageQueues: {},
  queuePaused: {},
```

**Step 4: Implement the 7 queue actions**

Add after the `compactContext` action (after line 258):

```typescript
  addToQueue: (conversationId, content, attachments?) => {
    set((s) => {
      const queue = s.messageQueues[conversationId] || []
      return {
        messageQueues: {
          ...s.messageQueues,
          [conversationId]: [...queue, {
            id: crypto.randomUUID(),
            content,
            attachments,
            createdAt: Date.now(),
          }],
        },
      }
    })
  },

  removeFromQueue: (conversationId, messageId) => {
    set((s) => {
      const queue = (s.messageQueues[conversationId] || []).filter((m) => m.id !== messageId)
      if (queue.length === 0) {
        const { [conversationId]: _, ...rest } = s.messageQueues
        return { messageQueues: rest }
      }
      return { messageQueues: { ...s.messageQueues, [conversationId]: queue } }
    })
  },

  editQueuedMessage: (conversationId, messageId, newContent) => {
    set((s) => {
      const queue = (s.messageQueues[conversationId] || []).map((m) =>
        m.id === messageId ? { ...m, content: newContent } : m
      )
      return { messageQueues: { ...s.messageQueues, [conversationId]: queue } }
    })
  },

  reorderQueue: (conversationId, fromIndex, toIndex) => {
    set((s) => {
      const queue = [...(s.messageQueues[conversationId] || [])]
      const [item] = queue.splice(fromIndex, 1)
      queue.splice(toIndex, 0, item)
      return { messageQueues: { ...s.messageQueues, [conversationId]: queue } }
    })
  },

  clearQueue: (conversationId) => {
    set((s) => {
      const { [conversationId]: _, ...rest } = s.messageQueues
      const { [conversationId]: __, ...pausedRest } = s.queuePaused
      return { messageQueues: rest, queuePaused: pausedRest }
    })
  },

  pauseQueue: (conversationId) => {
    set((s) => ({
      queuePaused: { ...s.queuePaused, [conversationId]: true },
    }))
  },

  resumeQueue: (conversationId) => {
    set((s) => {
      const { [conversationId]: _, ...rest } = s.queuePaused
      return { queuePaused: rest }
    })
  },
```

**Step 5: Run tests to verify they pass**

Run: `npm test -- src/renderer/stores/chatStore.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: All queue tests PASS

**Step 6: Commit**

```bash
git add src/renderer/stores/chatStore.ts src/renderer/stores/chatStore.test.ts
git commit -m "feat(queue): add message queue state and actions to chatStore"
```

---

### Task 2: Add queue drain logic to streamOperation

**Files:**
- Modify: `src/renderer/stores/chatStore.ts:90-109` (streamOperation function)
- Test: `src/renderer/stores/chatStore.test.ts`

**Step 1: Write the failing tests**

Add to `src/renderer/stores/chatStore.test.ts` inside the `message queue` describe:

```typescript
  it('streamOperation drains queue after stream completes', async () => {
    // Setup: conversation streaming with queued message
    useChatStore.setState({
      activeConversationId: 1,
      streamBuffers: { 1: [] },
      messageQueues: { 1: [{ id: 'q1', content: 'queued msg', createdAt: Date.now() }] },
      queuePaused: {},
    })

    mockAgent.messages.send.mockResolvedValueOnce({ id: 2, role: 'assistant', content: 'done' })
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, title: 'Test', messages: [] })

    // Trigger sendMessage which calls streamOperation
    // After it resolves, the queued message should have been sent
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
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/stores/chatStore.test.ts --reporter=verbose -t "queue" 2>&1 | tail -20`
Expected: FAIL — drain/pause behavior not implemented

**Step 3: Modify streamOperation to drain queue**

Replace `streamOperation` function (lines 90-109):

```typescript
async function streamOperation(
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
  conversationId: number,
  ipcCall: () => Promise<unknown>,
  errorLabel: string
): Promise<void> {
  try {
    await ipcCall()
    await new Promise((r) => setTimeout(r, 50))
    if (get().activeConversationId === conversationId) {
      await get().loadMessages(conversationId)
    }
    set(cleanupStreamBuffer(get(), conversationId))

    // Drain queue: send next queued message if not paused
    const queue = get().messageQueues[conversationId]
    if (queue?.length && !get().queuePaused[conversationId]) {
      const [next, ...rest] = queue
      set({
        messageQueues: rest.length
          ? { ...get().messageQueues, [conversationId]: rest }
          : (() => { const { [conversationId]: _, ...r } = get().messageQueues; return r })(),
      })
      await get().sendMessage(conversationId, next.content, next.attachments)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : errorLabel
    const cleanup = cleanupStreamBuffer(get(), conversationId)
    // Pause queue on error
    set(get().activeConversationId === conversationId
      ? { error: msg, ...cleanup, queuePaused: { ...get().queuePaused, [conversationId]: true } }
      : { ...cleanup, queuePaused: { ...get().queuePaused, [conversationId]: true } }
    )
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/renderer/stores/chatStore.test.ts --reporter=verbose -t "queue" 2>&1 | tail -20`
Expected: PASS

**Step 5: Run full chatStore test suite to check for regressions**

Run: `npm test -- src/renderer/stores/chatStore.test.ts --reporter=verbose 2>&1 | tail -30`
Expected: All existing tests still PASS

**Step 6: Commit**

```bash
git add src/renderer/stores/chatStore.ts src/renderer/stores/chatStore.test.ts
git commit -m "feat(queue): add auto-drain logic to streamOperation"
```

---

### Task 3: Add queue pause on stop/regenerate/edit

**Files:**
- Modify: `src/renderer/stores/chatStore.ts:163-166` (stopGeneration)
- Modify: `src/renderer/stores/chatStore.ts:168-187` (regenerateLastResponse)
- Modify: `src/renderer/stores/chatStore.ts:189-225` (editMessage)
- Test: `src/renderer/stores/chatStore.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('queue pause on stop/regenerate/edit', () => {
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
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/stores/chatStore.test.ts -t "queue pause" 2>&1 | tail -15`
Expected: FAIL

**Step 3: Add pause logic to stopGeneration**

Replace `stopGeneration` (lines 163-166):

```typescript
  stopGeneration: async () => {
    const convId = get().activeConversationId
    if (convId) {
      set({ queuePaused: { ...get().queuePaused, [convId]: true } })
      await window.agent.messages.stop(convId)
    }
  },
```

**Step 4: Add pause logic to regenerateLastResponse**

In `regenerateLastResponse`, add queue pause to the optimistic `set` call (inside the `set((s) => ({...}))` block):

Add to the return object of the set call:
```typescript
      queuePaused: { ...get().queuePaused, [conversationId]: true },
```

**Step 5: Add pause logic to editMessage**

In `editMessage`, add queue pause to the optimistic `set` call:

Add to the return object of the set call:
```typescript
        queuePaused: convId != null ? { ...s.queuePaused, [convId]: true } : s.queuePaused,
```

Note: `editMessage` uses `s` (set callback state) not `get()`, and `convId` is declared just above the set call — so we need to capture it before the set, or use `get().activeConversationId` inside. Check the exact variable scope at implementation time.

**Step 6: Run tests to verify they pass**

Run: `npm test -- src/renderer/stores/chatStore.test.ts -t "queue pause" 2>&1 | tail -15`
Expected: PASS

**Step 7: Commit**

```bash
git add src/renderer/stores/chatStore.ts src/renderer/stores/chatStore.test.ts
git commit -m "feat(queue): pause queue on stop, regenerate, and edit"
```

---

### Task 4: Add resumeQueue with drain trigger

**Files:**
- Modify: `src/renderer/stores/chatStore.ts` (resumeQueue action)
- Test: `src/renderer/stores/chatStore.test.ts`

**Step 1: Write the failing test**

```typescript
  it('resumeQueue sends next queued message if not streaming', async () => {
    useChatStore.setState({
      activeConversationId: 1,
      streamBuffers: {},  // NOT streaming
      messageQueues: { 1: [{ id: 'q1', content: 'queued msg', createdAt: Date.now() }] },
      queuePaused: { 1: true },
    })

    mockAgent.messages.send.mockResolvedValueOnce({ id: 2, role: 'assistant', content: 'reply' })
    mockAgent.conversations.get.mockResolvedValueOnce({ id: 1, messages: [] })

    await useChatStore.getState().resumeQueue(1)

    expect(useChatStore.getState().queuePaused[1]).toBeFalsy()
    // Queue should have been drained
    expect(useChatStore.getState().messageQueues[1] || []).toHaveLength(0)
  })

  it('resumeQueue does not send if currently streaming', () => {
    useChatStore.setState({
      activeConversationId: 1,
      streamBuffers: { 1: [] },  // currently streaming
      messageQueues: { 1: [{ id: 'q1', content: 'queued', createdAt: Date.now() }] },
      queuePaused: { 1: true },
    })

    useChatStore.getState().resumeQueue(1)

    // Queue should remain — drain will happen after current stream via streamOperation
    expect(useChatStore.getState().messageQueues[1]).toHaveLength(1)
    expect(useChatStore.getState().queuePaused[1]).toBeFalsy()
  })
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/stores/chatStore.test.ts -t "resumeQueue" 2>&1 | tail -15`
Expected: FAIL

**Step 3: Update resumeQueue to trigger drain**

Replace the current `resumeQueue` action:

```typescript
  resumeQueue: (conversationId) => {
    const { [conversationId]: _, ...rest } = get().queuePaused
    set({ queuePaused: rest })

    // If not currently streaming, drain immediately
    const isConvStreaming = conversationId in get().streamBuffers
    const queue = get().messageQueues[conversationId]
    if (!isConvStreaming && queue?.length) {
      const [next, ...remaining] = queue
      set({
        messageQueues: remaining.length
          ? { ...get().messageQueues, [conversationId]: remaining }
          : (() => { const { [conversationId]: _, ...r } = get().messageQueues; return r })(),
      })
      get().sendMessage(conversationId, next.content, next.attachments)
    }
  },
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/renderer/stores/chatStore.test.ts -t "resumeQueue" 2>&1 | tail -15`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/stores/chatStore.ts src/renderer/stores/chatStore.test.ts
git commit -m "feat(queue): resumeQueue triggers drain when not streaming"
```

---

### Task 5: Route MessageInput sends to queue

**Files:**
- Modify: `src/renderer/components/chat/MessageInput.tsx:9-25` (props interface)
- Modify: `src/renderer/components/chat/MessageInput.tsx:89-104` (handleSend)
- Modify: `src/renderer/pages/ChatView.tsx` (pass new props)
- Test: `src/renderer/components/chat/MessageInput.test.tsx` (if exists, otherwise create)

**Step 1: Write the failing test**

In the existing `MessageInput` test file (or create one), add:

```typescript
  it('routes send to onQueue when hasQueuedMessages is true', async () => {
    const onSend = vi.fn()
    const onQueue = vi.fn()
    render(
      <MessageInput
        onSend={onSend}
        onQueue={onQueue}
        disabled={false}
        isStreaming={false}
        hasQueuedMessages={true}
      />
    )

    const textarea = screen.getByRole('textbox')
    await userEvent.type(textarea, 'test message')
    await userEvent.keyboard('{Enter}')

    expect(onQueue).toHaveBeenCalledWith('test message')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('routes send to onQueue when isStreaming is true', async () => {
    const onSend = vi.fn()
    const onQueue = vi.fn()
    render(
      <MessageInput
        onSend={onSend}
        onQueue={onQueue}
        disabled={false}
        isStreaming={true}
        hasQueuedMessages={false}
      />
    )

    const textarea = screen.getByRole('textbox')
    await userEvent.type(textarea, 'queued message')
    await userEvent.keyboard('{Enter}')

    expect(onQueue).toHaveBeenCalledWith('queued message')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('routes to onSend when not streaming and no queue', async () => {
    const onSend = vi.fn()
    const onQueue = vi.fn()
    render(
      <MessageInput
        onSend={onSend}
        onQueue={onQueue}
        disabled={false}
        isStreaming={false}
        hasQueuedMessages={false}
      />
    )

    const textarea = screen.getByRole('textbox')
    await userEvent.type(textarea, 'direct message')
    await userEvent.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith('direct message')
    expect(onQueue).not.toHaveBeenCalled()
  })
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/components/chat/MessageInput.test.tsx --reporter=verbose 2>&1 | tail -20`
Expected: FAIL

**Step 3: Add new props to MessageInput**

In `MessageInputProps` (lines 14-25), add:

```typescript
  onQueue?: (content: string) => void
  hasQueuedMessages?: boolean
```

**Step 4: Update handleSend to route to queue**

Replace `handleSend` (lines 89-104):

```typescript
    const handleSend = useCallback(() => {
      const trimmed = content.trim()
      if (!trimmed || disabled) return
      // Resolve @mentions to markdown links before sending
      let resolved = trimmed
      for (const m of resolvedMentions) {
        resolved = resolved.replaceAll(`@${m.display}`, `[${m.name}](${m.path})`)
      }

      if ((isStreaming || hasQueuedMessages) && onQueue) {
        onQueue(resolved)
      } else {
        onSend(resolved)
      }

      setContent('')
      setResolvedMentions([])
      setMentionOpen(false)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }, [content, disabled, isStreaming, hasQueuedMessages, onSend, onQueue, resolvedMentions])
```

Key changes:
- Removed `isStreaming` from the early-return guard (textarea is no longer blocked during streaming)
- Added routing: `(isStreaming || hasQueuedMessages) && onQueue` → `onQueue(resolved)`, else → `onSend(resolved)`

**Step 5: Wire new props in ChatView.tsx**

In `ChatView.tsx`, import the queue store selectors and add `onQueue` and `hasQueuedMessages` to both `MessageInput` render sites.

In `ChatView.tsx` `handleSend` area, add:

```typescript
  const messageQueues = useChatStore((s) => s.messageQueues)
  const addToQueue = useChatStore((s) => s.addToQueue)

  const hasQueuedMessages = conversationId != null && (messageQueues[conversationId]?.length ?? 0) > 0

  const handleQueue = useCallback((content: string) => {
    if (!conversationId) return
    addToQueue(conversationId, content, attachments.length > 0 ? attachments : undefined)
    setAttachments([])
  }, [conversationId, addToQueue, attachments])
```

Add props to both `MessageInput` JSX (desktop ~line 528 and compact ~line 480):

```tsx
  onQueue={handleQueue}
  hasQueuedMessages={hasQueuedMessages}
```

**Step 6: Run tests to verify they pass**

Run: `npm test -- src/renderer/components/chat/MessageInput.test.tsx --reporter=verbose 2>&1 | tail -20`
Expected: PASS

**Step 7: Commit**

```bash
git add src/renderer/components/chat/MessageInput.tsx src/renderer/pages/ChatView.tsx src/renderer/components/chat/MessageInput.test.tsx
git commit -m "feat(queue): route sends to queue when streaming or queue non-empty"
```

---

### Task 6: Create QueueItem component

**Files:**
- Create: `src/renderer/components/chat/QueueItem.tsx`
- Test: `src/renderer/components/chat/QueueItem.test.tsx`

**Step 1: Write the failing test**

Create `src/renderer/components/chat/QueueItem.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { QueueItem } from './QueueItem'

describe('QueueItem', () => {
  const defaultProps = {
    id: 'q1',
    content: 'Fix the login bug in the auth module',
    index: 0,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onDragStart: vi.fn(),
  }

  it('renders truncated content', () => {
    render(<QueueItem {...defaultProps} />)
    expect(screen.getByText(/Fix the login bug/)).toBeInTheDocument()
  })

  it('calls onDelete when delete button clicked', async () => {
    const onDelete = vi.fn()
    render(<QueueItem {...defaultProps} onDelete={onDelete} />)

    await userEvent.click(screen.getByLabelText('Delete queued message'))
    expect(onDelete).toHaveBeenCalledWith('q1')
  })

  it('enters edit mode and saves on Enter', async () => {
    const onEdit = vi.fn()
    render(<QueueItem {...defaultProps} onEdit={onEdit} />)

    await userEvent.click(screen.getByLabelText('Edit queued message'))

    const input = screen.getByDisplayValue('Fix the login bug in the auth module')
    await userEvent.clear(input)
    await userEvent.type(input, 'Updated content{Enter}')

    expect(onEdit).toHaveBeenCalledWith('q1', 'Updated content')
  })

  it('exits edit mode on Escape without saving', async () => {
    const onEdit = vi.fn()
    render(<QueueItem {...defaultProps} onEdit={onEdit} />)

    await userEvent.click(screen.getByLabelText('Edit queued message'))
    await userEvent.keyboard('{Escape}')

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText(/Fix the login bug/)).toBeInTheDocument()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/components/chat/QueueItem.test.tsx --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — module not found

**Step 3: Implement QueueItem**

Create `src/renderer/components/chat/QueueItem.tsx`:

```tsx
import { useState, useCallback, useRef } from 'react'

interface QueueItemProps {
  id: string
  content: string
  index: number
  onEdit: (id: string, newContent: string) => void
  onDelete: (id: string) => void
  onDragStart: (index: number, e: React.MouseEvent) => void
}

export function QueueItem({ id, content, index, onEdit, onDelete, onDragStart }: QueueItemProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(content)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleEditClick = useCallback(() => {
    setEditValue(content)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [content])

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== content) {
      onEdit(id, trimmed)
    }
    setEditing(false)
  }, [editValue, content, id, onEdit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }, [handleSave])

  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded text-sm group"
         style={{ backgroundColor: 'var(--color-surface)' }}>
      <button
        className="cursor-grab opacity-50 hover:opacity-100 flex-shrink-0"
        onMouseDown={(e) => onDragStart(index, e)}
        aria-label="Drag to reorder"
      >
        ≡
      </button>

      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 bg-transparent border-b outline-none text-body"
          style={{ borderColor: 'var(--color-primary)' }}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
        />
      ) : (
        <span className="flex-1 truncate text-body">{content}</span>
      )}

      {!editing && (
        <>
          <button
            className="opacity-0 group-hover:opacity-70 hover:opacity-100 flex-shrink-0"
            onClick={handleEditClick}
            aria-label="Edit queued message"
          >
            ✎
          </button>
          <button
            className="opacity-0 group-hover:opacity-70 hover:opacity-100 flex-shrink-0"
            onClick={() => onDelete(id)}
            aria-label="Delete queued message"
          >
            ✕
          </button>
        </>
      )}
    </div>
  )
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/renderer/components/chat/QueueItem.test.tsx --reporter=verbose 2>&1 | tail -20`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/components/chat/QueueItem.tsx src/renderer/components/chat/QueueItem.test.tsx
git commit -m "feat(queue): create QueueItem component with edit/delete/drag"
```

---

### Task 7: Create QueuePanel component

**Files:**
- Create: `src/renderer/components/chat/QueuePanel.tsx`
- Test: `src/renderer/components/chat/QueuePanel.test.tsx`

**Step 1: Write the failing test**

Create `src/renderer/components/chat/QueuePanel.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueuePanel } from './QueuePanel'
import type { QueuedMessage } from '../../stores/chatStore'

describe('QueuePanel', () => {
  const mockMessages: QueuedMessage[] = [
    { id: 'q1', content: 'First message', createdAt: 1 },
    { id: 'q2', content: 'Second message', createdAt: 2 },
  ]

  const defaultProps = {
    messages: mockMessages,
    paused: false,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    onClear: vi.fn(),
    onResume: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders message count', () => {
    render(<QueuePanel {...defaultProps} />)
    expect(screen.getByText(/Queue \(2\)/)).toBeInTheDocument()
  })

  it('renders all queued messages', () => {
    render(<QueuePanel {...defaultProps} />)
    expect(screen.getByText('First message')).toBeInTheDocument()
    expect(screen.getByText('Second message')).toBeInTheDocument()
  })

  it('shows Resume button when paused', () => {
    render(<QueuePanel {...defaultProps} paused={true} />)
    expect(screen.getByText(/Resume/)).toBeInTheDocument()
  })

  it('does not show Resume button when not paused', () => {
    render(<QueuePanel {...defaultProps} paused={false} />)
    expect(screen.queryByText(/Resume/)).not.toBeInTheDocument()
  })

  it('calls onClear when Clear button clicked', async () => {
    const onClear = vi.fn()
    render(<QueuePanel {...defaultProps} onClear={onClear} />)

    await userEvent.click(screen.getByLabelText('Clear queue'))
    expect(onClear).toHaveBeenCalled()
  })

  it('calls onResume when Resume button clicked', async () => {
    const onResume = vi.fn()
    render(<QueuePanel {...defaultProps} paused={true} onResume={onResume} />)

    await userEvent.click(screen.getByText(/Resume/))
    expect(onResume).toHaveBeenCalled()
  })

  it('returns null when messages array is empty', () => {
    const { container } = render(<QueuePanel {...defaultProps} messages={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/renderer/components/chat/QueuePanel.test.tsx --reporter=verbose 2>&1 | tail -20`
Expected: FAIL — module not found

**Step 3: Implement QueuePanel**

Create `src/renderer/components/chat/QueuePanel.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react'
import { QueueItem } from './QueueItem'
import type { QueuedMessage } from '../../stores/chatStore'

interface QueuePanelProps {
  messages: QueuedMessage[]
  paused: boolean
  onEdit: (messageId: string, newContent: string) => void
  onDelete: (messageId: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onClear: () => void
  onResume: () => void
}

export function QueuePanel({ messages, paused, onEdit, onDelete, onReorder, onClear, onResume }: QueuePanelProps) {
  if (messages.length === 0) return null

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const handleDragStart = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault()
    setDragIndex(index)

    const startY = e.clientY
    const items = listRef.current?.children
    if (!items) return

    const itemHeight = (items[0] as HTMLElement).offsetHeight

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY
      const offset = Math.round(delta / itemHeight)
      const target = Math.max(0, Math.min(messages.length - 1, index + offset))
      setDropIndex(target)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const target = dropIndex ?? index
      if (target !== index) {
        onReorder(index, target)
      }
      setDragIndex(null)
      setDropIndex(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [messages.length, onReorder, dropIndex])

  return (
    <div className="flex-shrink-0 px-4 py-2 border-t" style={{ borderColor: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-contrast">
          Queue ({messages.length}){paused ? ' — Paused' : ''}
        </span>
        <div className="flex gap-1">
          {paused && (
            <button
              className="text-xs px-2 py-0.5 rounded hover:opacity-80"
              style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-base)' }}
              onClick={onResume}
            >
              ▶ Resume
            </button>
          )}
          <button
            className="text-xs px-2 py-0.5 rounded opacity-60 hover:opacity-100"
            style={{ color: 'var(--color-body)' }}
            onClick={onClear}
            aria-label="Clear queue"
          >
            ✕ Clear
          </button>
        </div>
      </div>
      <div ref={listRef} className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
        {messages.map((msg, i) => (
          <QueueItem
            key={msg.id}
            id={msg.id}
            content={msg.content}
            index={i}
            onEdit={onEdit}
            onDelete={onDelete}
            onDragStart={handleDragStart}
          />
        ))}
      </div>
    </div>
  )
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/renderer/components/chat/QueuePanel.test.tsx --reporter=verbose 2>&1 | tail -20`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/components/chat/QueuePanel.tsx src/renderer/components/chat/QueuePanel.test.tsx
git commit -m "feat(queue): create QueuePanel component with resume/clear/drag-reorder"
```

---

### Task 8: Integrate QueuePanel into ChatView

**Files:**
- Modify: `src/renderer/pages/ChatView.tsx` (import + render QueuePanel, wire props)

**Step 1: Add imports and store selectors**

Add import at the top of ChatView.tsx:

```typescript
import { QueuePanel } from '../components/chat/QueuePanel'
```

Add store selectors near the existing `useChatStore()` destructure (around line 36). Add these additional selectors below the existing destructure:

```typescript
  const messageQueues = useChatStore((s) => s.messageQueues)
  const queuePaused = useChatStore((s) => s.queuePaused)
  const addToQueue = useChatStore((s) => s.addToQueue)
  const removeFromQueue = useChatStore((s) => s.removeFromQueue)
  const editQueuedMessage = useChatStore((s) => s.editQueuedMessage)
  const reorderQueue = useChatStore((s) => s.reorderQueue)
  const clearQueue = useChatStore((s) => s.clearQueue)
  const resumeQueue = useChatStore((s) => s.resumeQueue)
```

**Step 2: Add derived state and handlers**

Near the existing `handleSend` (around line 298), add:

```typescript
  const currentQueue = conversationId != null ? messageQueues[conversationId] ?? [] : []
  const currentQueuePaused = conversationId != null ? !!queuePaused[conversationId] : false
  const hasQueuedMessages = currentQueue.length > 0

  const handleQueue = useCallback((content: string) => {
    if (!conversationId) return
    addToQueue(conversationId, content, attachments.length > 0 ? attachments : undefined)
    setAttachments([])
  }, [conversationId, addToQueue, attachments])

  const handleQueueEdit = useCallback((messageId: string, newContent: string) => {
    if (conversationId) editQueuedMessage(conversationId, messageId, newContent)
  }, [conversationId, editQueuedMessage])

  const handleQueueDelete = useCallback((messageId: string) => {
    if (conversationId) removeFromQueue(conversationId, messageId)
  }, [conversationId, removeFromQueue])

  const handleQueueReorder = useCallback((from: number, to: number) => {
    if (conversationId) reorderQueue(conversationId, from, to)
  }, [conversationId, reorderQueue])

  const handleQueueClear = useCallback(() => {
    if (conversationId) clearQueue(conversationId)
  }, [conversationId, clearQueue])

  const handleQueueResume = useCallback(() => {
    if (conversationId) resumeQueue(conversationId)
  }, [conversationId, resumeQueue])
```

**Step 3: Render QueuePanel in JSX**

Insert `<QueuePanel>` between `AttachmentPreview` (around line 438) and `ChatStatusLine` (around line 440). Add in both compact and desktop layouts.

```tsx
              <QueuePanel
                messages={currentQueue}
                paused={currentQueuePaused}
                onEdit={handleQueueEdit}
                onDelete={handleQueueDelete}
                onReorder={handleQueueReorder}
                onClear={handleQueueClear}
                onResume={handleQueueResume}
              />
```

**Step 4: Pass queue props to MessageInput**

Add to both `MessageInput` render sites (desktop ~line 528, compact ~line 480):

```tsx
  onQueue={handleQueue}
  hasQueuedMessages={hasQueuedMessages}
```

**Step 5: Build and verify**

Run: `npm run build 2>&1 | tail -10`
Expected: 0 errors, 0 warnings

**Step 6: Run full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: All tests pass (existing + new)

**Step 7: Commit**

```bash
git add src/renderer/pages/ChatView.tsx
git commit -m "feat(queue): integrate QueuePanel into ChatView with full wiring"
```

---

### Task 9: Manual smoke test and polish

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Smoke test checklist**

1. Open a conversation, send a message → normal behavior (no queue)
2. While AI streams, type and send a second message → should appear in queue panel above textarea
3. While AI streams, type and send a third message → queue shows 2 items
4. Wait for stream to finish → first queued message auto-sends
5. Wait again → second queued message auto-sends
6. While streaming, click Stop → queue shows "Paused"
7. Click Resume → queued messages resume processing
8. Add items to queue, then click Clear → queue empties
9. Add items, click edit button → inline edit works
10. Reorder items via drag handle → order changes
11. Switch to another conversation → queue persists for original conversation
12. Switch back → queue is still there

**Step 3: Fix any visual issues**

Adjust spacing, colors, max-height, scrollbar behavior as needed. All styles must use CSS variables from the theme system.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(queue): polish queue panel styling and fix edge cases"
```
