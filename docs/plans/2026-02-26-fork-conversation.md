# Fork Conversation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to fork a conversation from any message, creating a new conversation with copied messages up to that point (respecting `cleared_at` boundaries).

**Architecture:** New `conversations:fork` IPC handler performs atomic SQL transaction (create conversation + bulk copy messages). Renderer adds `onFork` prop to MessageBubble, wired through MessageList and ChatView to the conversations store.

**Tech Stack:** Electron IPC, better-sqlite3 transactions, React, Zustand

---

### Task 1: Main — `conversations:fork` IPC handler + tests

**Files:**
- Modify: `src/main/services/conversations.ts:181` (before closing brace)
- Test: `src/main/services/conversations.test.ts`

**Step 1: Write the failing tests**

Add to the end of `src/main/services/conversations.test.ts`, inside the existing `describe` block:

```typescript
  describe('fork', () => {
    it('creates a new conversation with "Fork: " prefix title', async () => {
      const conv = await ipc.invoke('conversations:create', 'Original Chat') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'hello', '2025-01-01T00:00:01Z')
      const msg = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(conv.id) as any

      const fork = await ipc.invoke('conversations:fork', conv.id, msg.id) as any
      expect(fork.title).toBe('Fork: Original Chat')
      expect(fork.id).not.toBe(conv.id)
    })

    it('copies messages up to and including the target message', async () => {
      const conv = await ipc.invoke('conversations:create', 'Test') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'msg1', '2025-01-01T00:00:01Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'assistant', 'msg2', '2025-01-01T00:00:02Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'msg3', '2025-01-01T00:00:03Z')
      const targetMsg = db.prepare("SELECT * FROM messages WHERE content = 'msg2'").get() as any

      const fork = await ipc.invoke('conversations:fork', conv.id, targetMsg.id) as any
      const forkFull = await ipc.invoke('conversations:get', fork.id) as any
      expect(forkFull.messages).toHaveLength(2)
      expect(forkFull.messages[0].content).toBe('msg1')
      expect(forkFull.messages[1].content).toBe('msg2')
    })

    it('respects cleared_at boundary', async () => {
      const conv = await ipc.invoke('conversations:create', 'Cleared') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'before-clear', '2025-01-01T00:00:01Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'assistant', 'also-before', '2025-01-01T00:00:02Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'after-clear', '2025-01-01T00:00:04Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'assistant', 'response', '2025-01-01T00:00:05Z')
      // Set cleared_at between msg2 and msg3
      await ipc.invoke('conversations:update', conv.id, { cleared_at: '2025-01-01T00:00:03Z' })
      const targetMsg = db.prepare("SELECT * FROM messages WHERE content = 'response'").get() as any

      const fork = await ipc.invoke('conversations:fork', conv.id, targetMsg.id) as any
      const forkFull = await ipc.invoke('conversations:get', fork.id) as any
      expect(forkFull.messages).toHaveLength(2)
      expect(forkFull.messages[0].content).toBe('after-clear')
      expect(forkFull.messages[1].content).toBe('response')
    })

    it('clones folder_id, cwd, model, system_prompt, ai_overrides, kb_enabled', async () => {
      const folder = await ipc.invoke('folders:create', 'TestFolder') as any
      const conv = await ipc.invoke('conversations:create', 'Settings Test') as any
      await ipc.invoke('conversations:update', conv.id, {
        folder_id: folder.id,
        cwd: '/tmp/work',
        model: 'claude-opus-4-6-20250725',
        system_prompt: 'Be helpful',
        ai_overrides: '{"temperature":"0.5"}',
        kb_enabled: 1,
      })
      db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', 'hello', '2025-01-01T00:00:01Z')
      const msg = db.prepare('SELECT * FROM messages WHERE conversation_id = ?').get(conv.id) as any

      const fork = await ipc.invoke('conversations:fork', conv.id, msg.id) as any
      expect(fork.folder_id).toBe(folder.id)
      expect(fork.cwd).toBe('/tmp/work')
      expect(fork.model).toBe('claude-opus-4-6-20250725')
      expect(fork.system_prompt).toBe('Be helpful')
      expect(fork.ai_overrides).toBe('{"temperature":"0.5"}')
      expect(fork.kb_enabled).toBe(1)
      expect(fork.cleared_at).toBeNull()
    })

    it('copies attachments and tool_calls JSON', async () => {
      const conv = await ipc.invoke('conversations:create', 'Attachments') as any
      db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(conv.id, 'user', 'with files', '[{"path":"/tmp/a.png"}]', null, '2025-01-01T00:00:01Z')
      db.prepare('INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(conv.id, 'assistant', 'used tools', '[]', '[{"name":"bash","input":"ls"}]', '2025-01-01T00:00:02Z')
      const targetMsg = db.prepare("SELECT * FROM messages WHERE content = 'used tools'").get() as any

      const fork = await ipc.invoke('conversations:fork', conv.id, targetMsg.id) as any
      const forkFull = await ipc.invoke('conversations:get', fork.id) as any
      expect(forkFull.messages[0].attachments).toBe('[{"path":"/tmp/a.png"}]')
      expect(forkFull.messages[1].tool_calls).toBe('[{"name":"bash","input":"ls"}]')
    })

    it('throws on invalid conversationId', async () => {
      await expect(ipc.invoke('conversations:fork', -1, 1)).rejects.toThrow()
    })

    it('throws on nonexistent conversation', async () => {
      await expect(ipc.invoke('conversations:fork', 99999, 1)).rejects.toThrow('Conversation not found')
    })

    it('throws on nonexistent message', async () => {
      const conv = await ipc.invoke('conversations:create', 'Empty') as any
      await expect(ipc.invoke('conversations:fork', conv.id, 99999)).rejects.toThrow('Message not found')
    })
  })
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/services/conversations.test.ts`
Expected: FAIL — `No handler for conversations:fork`

**Step 3: Write the implementation**

Add before the closing `}` of `registerHandlers` in `src/main/services/conversations.ts`:

```typescript
  ipcMain.handle(
    'conversations:fork',
    (_e, sourceConversationId: number, messageId: number) => {
      validatePositiveInt(sourceConversationId, 'sourceConversationId')
      validatePositiveInt(messageId, 'messageId')

      const source = db
        .prepare('SELECT * FROM conversations WHERE id = ?')
        .get(sourceConversationId) as Record<string, unknown> | undefined
      if (!source) throw new Error('Conversation not found')

      const targetMessage = db
        .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
        .get(messageId, sourceConversationId) as Record<string, unknown> | undefined
      if (!targetMessage) throw new Error('Message not found')

      const forkConv = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO conversations (title, folder_id, model, system_prompt, kb_enabled, cwd, ai_overrides, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .run(
            `Fork: ${source.title}`,
            source.folder_id,
            source.model,
            source.system_prompt,
            source.kb_enabled,
            source.cwd,
            source.ai_overrides
          )
        const newId = result.lastInsertRowid

        const clearedAt = source.cleared_at as string | null
        if (clearedAt) {
          db.prepare(
            `INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at, updated_at)
             SELECT ?, role, content, attachments, tool_calls, created_at, updated_at
             FROM messages
             WHERE conversation_id = ? AND created_at <= ? AND created_at > ?
             ORDER BY created_at ASC`
          ).run(newId, sourceConversationId, targetMessage.created_at, clearedAt)
        } else {
          db.prepare(
            `INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at, updated_at)
             SELECT ?, role, content, attachments, tool_calls, created_at, updated_at
             FROM messages
             WHERE conversation_id = ? AND created_at <= ?
             ORDER BY created_at ASC`
          ).run(newId, sourceConversationId, targetMessage.created_at)
        }

        return newId
      })()

      return db
        .prepare('SELECT * FROM conversations WHERE id = ?')
        .get(forkConv)
    }
  )
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/conversations.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/main/services/conversations.ts src/main/services/conversations.test.ts
git commit -m "feat: add conversations:fork IPC handler with tests"
```

---

### Task 2: Preload — wire `fork` through IPC bridge

**Files:**
- Modify: `src/preload/api.d.ts:43` (inside `conversations` block)
- Modify: `src/preload/index.ts:31` (inside `conversations` object)

**Step 1: Add type to `api.d.ts`**

In `src/preload/api.d.ts`, inside the `conversations` block (after `search` line 43):

```typescript
    fork(conversationId: number, messageId: number): Promise<Conversation>
```

**Step 2: Add implementation to `index.ts`**

In `src/preload/index.ts`, inside the `conversations` object (after `generateTitle` line 31):

```typescript
    fork: (conversationId: number, messageId: number) => withTimeout(ipcRenderer.invoke('conversations:fork', conversationId, messageId)),
```

**Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/preload/api.d.ts src/preload/index.ts
git commit -m "feat: wire conversations:fork through preload bridge"
```

---

### Task 3: Store — add `forkConversation` action

**Files:**
- Modify: `src/renderer/stores/conversationsStore.ts`

**Step 1: Add `forkConversation` to the interface and implementation**

In `src/renderer/stores/conversationsStore.ts`:

Add to the `ConversationsState` interface (after `importConversation`):

```typescript
  forkConversation: (conversationId: number, messageId: number) => Promise<Conversation>
```

Add to the store implementation (after `importConversation` action):

```typescript
  forkConversation: async (conversationId, messageId) => {
    const conversation = await window.agent.conversations.fork(conversationId, messageId)
    set((s) => ({ conversations: [conversation, ...s.conversations] }))
    set({ activeConversationId: conversation.id })
    if (WEB_MODE) sessionStorage.setItem(SESSION_KEY, String(conversation.id))
    return conversation
  },
```

**Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/renderer/stores/conversationsStore.ts
git commit -m "feat: add forkConversation action to conversations store"
```

---

### Task 4: UI — add "Fork from here" to MessageBubble + wire through MessageList and ChatView

**Files:**
- Modify: `src/renderer/components/chat/MessageBubble.tsx`
- Modify: `src/renderer/components/chat/MessageList.tsx`
- Modify: `src/renderer/pages/ChatView.tsx`
- Test: `src/renderer/components/chat/MessageBubble.test.tsx`

**Step 1: Write the failing test**

Add to `src/renderer/components/chat/MessageBubble.test.tsx`, inside the existing describe block:

```typescript
  it('shows Fork in context menu and calls onFork with message id', async () => {
    const onFork = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user', id: 42 })} isLast={false} onFork={onFork} />,
    )
    const bubble = container.querySelector('[role="presentation"]') || container.querySelector('.rounded-lg') || container.firstElementChild!.firstElementChild!
    await userEvent.pointer({ keys: '[MouseRight]', target: bubble })
    const forkBtn = screen.getByRole('menuitem', { name: /fork/i })
    expect(forkBtn).toBeDefined()
    await userEvent.click(forkBtn)
    expect(onFork).toHaveBeenCalledWith(42)
  })

  it('shows Fork in context menu for assistant messages too', async () => {
    const onFork = vi.fn()
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant', id: 7 })} isLast={false} onFork={onFork} />,
    )
    const bubble = container.firstElementChild!.firstElementChild!
    await userEvent.pointer({ keys: '[MouseRight]', target: bubble })
    const forkBtn = screen.getByRole('menuitem', { name: /fork/i })
    expect(forkBtn).toBeDefined()
    await userEvent.click(forkBtn)
    expect(onFork).toHaveBeenCalledWith(7)
  })
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/chat/MessageBubble.test.tsx`
Expected: FAIL — `onFork` prop doesn't exist / no Fork menuitem

**Step 3: Implement MessageBubble changes**

In `src/renderer/components/chat/MessageBubble.tsx`:

Add `onFork` to the props interface:

```typescript
interface MessageBubbleProps {
  message: Message
  isLast: boolean
  onEdit?: (messageId: number, content: string) => void
  onRegenerate?: () => void
  onFork?: (messageId: number) => void
}
```

Update the destructure:

```typescript
export function MessageBubble({ message, isLast, onEdit, onRegenerate, onFork }: MessageBubbleProps) {
```

Add the "Fork from here" button to the context menu, after the Copy button (inside the `showContextMenu` block):

```tsx
          {onFork && (
            <button
              onClick={() => { setShowContextMenu(false); onFork(message.id) }}
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-bg)]"
              style={{ backgroundColor: 'transparent' }}
              role="menuitem"
            >
              Fork from here
            </button>
          )}
```

**Step 4: Wire `onFork` through MessageList**

In `src/renderer/components/chat/MessageList.tsx`:

Add to `MessageListProps`:

```typescript
  onFork: (messageId: number) => void
```

Add `onFork` to the destructured props and pass it to `MessageBubble`:

```tsx
<MessageBubble
  message={msg}
  isLast={idx === messages.length - 1}
  onEdit={onEdit}
  onRegenerate={onRegenerate}
  onFork={onFork}
/>
```

**Step 5: Wire `onFork` in ChatView**

In `src/renderer/pages/ChatView.tsx`:

Import `useConversationsStore` is already imported. Add a `handleFork` callback:

```typescript
const { forkConversation } = useConversationsStore()

const handleFork = useCallback(async (messageId: number) => {
  if (!conversationId) return
  await forkConversation(conversationId, messageId)
}, [conversationId, forkConversation])
```

Pass it to `MessageList`:

```tsx
<MessageList
  messages={messages}
  clearedAt={clearedAt}
  isStreaming={isStreaming}
  streamParts={streamParts}
  streamingContent={streamingContent}
  isLoading={isLoading}
  onEdit={editMessage}
  onRegenerate={handleRegenerate}
  onStopGeneration={stopGeneration}
  onFork={handleFork}
/>
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/chat/MessageBubble.test.tsx`
Expected: PASS

**Step 7: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS (1510+ tests)

**Step 8: Commit**

```bash
git add src/renderer/components/chat/MessageBubble.tsx src/renderer/components/chat/MessageBubble.test.tsx src/renderer/components/chat/MessageList.tsx src/renderer/pages/ChatView.tsx
git commit -m "feat: add Fork from here to message context menu"
```

---

### Task 5: Manual verification

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Verify fork workflow**

1. Open an existing conversation with several messages
2. Right-click on a message in the middle of the conversation
3. Click "Fork from here"
4. Verify: new conversation appears with title "Fork: <original title>"
5. Verify: messages up to the clicked one are present
6. Verify: new conversation is in the same folder
7. Verify: navigation switches to the fork automatically

**Step 3: Verify cleared_at boundary**

1. In a conversation, use `/compact` to set a cleared_at boundary
2. Add a few more messages after the clear
3. Right-click on a post-clear message, click "Fork from here"
4. Verify: only messages after the clear boundary are copied

**Step 4: Run full test suite one last time**

Run: `npx vitest run`
Expected: ALL PASS
