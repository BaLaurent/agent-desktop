# Fork Conversation from Message — Design

## Summary

Allow users to fork a conversation from any message, creating a new conversation containing all messages up to and including the selected one (respecting `cleared_at` boundaries).

## Decisions

| Decision | Choice |
|----------|--------|
| Navigation after fork | Auto-navigate to the forked conversation |
| Title | `"Fork: <original title>"` |
| Cloned settings | folder_id, cwd, model, system_prompt, ai_overrides, kb_enabled |
| Attachments | Copy JSON references as-is (no file duplication) |
| UI visibility | "Fork from here" on all messages (user + assistant) |
| Approach | Single atomic IPC handler `conversations:fork` |

## Architecture

### New IPC handler — `conversations:fork`

**Location:** `src/main/services/conversations.ts`

**Signature:** `conversations:fork(sourceConversationId: number, messageId: number) → Conversation`

**Logic:**
1. Read source conversation (folder_id, cwd, model, system_prompt, ai_overrides, kb_enabled, cleared_at, title)
2. Read target message's `created_at`
3. In a single SQL transaction:
   - INSERT new conversation with title `"Fork: <title>"` and cloned settings
   - INSERT messages via bulk SELECT from source, filtered by:
     - `created_at <= targetMessage.created_at`
     - `cleared_at IS NULL OR created_at > cleared_at`
4. Return the new conversation row

### Preload type extension

**Location:** `src/preload/api.d.ts`

Add: `fork(conversationId: number, messageId: number): Promise<Conversation>`

### Renderer store action

**Location:** `src/renderer/stores/conversationsStore.ts`

New action `forkConversation(conversationId: number, messageId: number)`:
- Calls `window.agent.conversations.fork()`
- Prepends fork to `conversations` array
- Sets `activeConversationId` to the fork's id

### UI — MessageBubble context menu

**Location:** `src/renderer/components/chat/MessageBubble.tsx`

- Add "Fork from here" item to the right-click context menu
- New prop: `onFork?: (messageId: number) => void`
- Shown on all messages (user + assistant), unconditionally

### Message copy boundary

```sql
WHERE conversation_id = :sourceId
  AND created_at <= :targetMessageCreatedAt
  AND (:clearedAt IS NULL OR created_at > :clearedAt)
ORDER BY created_at ASC
```

## What does NOT change

- No new database tables
- No schema migration
- No parent-child link between conversations (YAGNI)
- Original conversation remains untouched
- No file duplication for attachments
