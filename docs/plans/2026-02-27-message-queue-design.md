# Message Queue Design

## Summary

Add sequential message queuing: when the AI is streaming a response, users can continue sending messages that accumulate in a queue and are processed one at a time after each stream completes.

## Requirements (from brainstorming)

- **Queue with editing**: queued messages appear in a dedicated panel above the textarea
- **Stop = Pause**: stopping generation pauses the queue; user must resume manually
- **Actions**: delete, edit content (inline), reorder (drag & drop)
- **No limit** on queue size
- **Per-conversation**: queue persists when switching conversations (volatile, not DB-persisted)
- **Renderer-only**: zero main process changes

## Approach

**Renderer-only queue** in `chatStore.ts` Zustand store. The main process remains unaware of the queue — it receives `messages:send` IPC calls one at a time, as before.

## Data Model

```typescript
interface QueuedMessage {
  id: string              // crypto.randomUUID()
  content: string
  attachments?: Attachment[]
  createdAt: number       // Date.now()
}

// New chatStore state:
messageQueues: Record<number, QueuedMessage[]>  // keyed by conversationId
queuePaused: Record<number, boolean>            // keyed by conversationId
```

## Queue Actions (chatStore)

| Action | Signature | Behavior |
|--------|-----------|----------|
| `addToQueue` | `(conversationId, content, attachments?) => void` | Push to `messageQueues[conversationId]` |
| `removeFromQueue` | `(conversationId, messageId) => void` | Splice from queue |
| `editQueuedMessage` | `(conversationId, messageId, newContent) => void` | Update content in place |
| `reorderQueue` | `(conversationId, fromIndex, toIndex) => void` | Splice + insert |
| `clearQueue` | `(conversationId) => void` | Delete queue entry |
| `pauseQueue` | `(conversationId) => void` | Set `queuePaused[conversationId] = true` |
| `resumeQueue` | `(conversationId) => void` | Set paused = false, drain if items exist |

## Flow

### Send while streaming

```
handleSend(content)
  if isStreaming OR messageQueues[conversationId]?.length > 0:
    addToQueue(conversationId, content, attachments)
  else:
    sendMessage(conversationId, content, attachments)  // existing behavior
```

### Auto-drain after stream completes

```
streamOperation completes
  → cleanup buffer (existing)
  → if messageQueues[conversationId]?.length > 0 AND !queuePaused[conversationId]:
      shift first message
      sendMessage(conversationId, msg.content, msg.attachments)
  → else: done
```

### Stop behavior

```
User clicks Stop
  → abortStream(conversationId)    // existing
  → pauseQueue(conversationId)      // NEW
```

### Resume behavior

```
User clicks Resume
  → queuePaused[conversationId] = false
  → if queue non-empty: shift + sendMessage()
```

### Error behavior

Stream error → pause queue + display error. User decides to retry or clear.

### Edge cases

- Regenerate/Edit/Compact/Clear during active queue: pause the queue
- Queue items for a non-streaming, non-paused conversation: send directly (queue is empty guard)

## UI Components

### QueuePanel (NEW: `src/renderer/components/chat/QueuePanel.tsx`)

Position: between chat messages and `MessageInput` in `ChatView.tsx`.
Rendered only when `messageQueues[conversationId]?.length > 0`.

```
┌────────────────────────────────────────────┐
│ Queue (3)              [▶ Resume] [✕ Clear] │
│ ┌─────────────────────────────────────────┐ │
│ │ ≡  Fix the login bug on page...  ✎  ✕  │ │
│ │ ≡  Add unit tests for auth...    ✎  ✕  │ │
│ │ ≡  Update the README with...     ✎  ✕  │ │
│ └─────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

- `≡` — drag handle (mousedown/mousemove/mouseup pattern, not HTML drag API)
- `✎` — edit button (toggles inline textarea)
- `✕` — delete this message
- `[▶ Resume]` — visible only when `queuePaused`; calls `resumeQueue()`
- `[✕ Clear]` — clears entire queue

### QueueItem (NEW: `src/renderer/components/chat/QueueItem.tsx`)

Individual queue row with drag handle, truncated content preview, edit mode toggle, and delete button.

## Files Modified

| File | Change |
|------|--------|
| `src/renderer/stores/chatStore.ts` | Add `messageQueues`, `queuePaused`, 7 actions, drain logic in `streamOperation` |
| `src/renderer/components/chat/MessageInput.tsx` | Route sends to queue when streaming or queue non-empty |
| `src/renderer/pages/ChatView.tsx` | Render `<QueuePanel>` between chat and input |
| `src/renderer/components/chat/QueuePanel.tsx` | **NEW** — queue container component |
| `src/renderer/components/chat/QueueItem.tsx` | **NEW** — individual queue item with drag/edit/delete |

**No main process changes. No DB migrations. No new IPC handlers.**
