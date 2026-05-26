# Save partial assistant message on manual stop

**Date:** 2026-05-26
**Status:** Approved (design)

## Context

When a user clicks Stop during a streaming response, the assistant content
generated so far is **discarded**. In `streamAndSave` (`src/core/handlers/messages.ts`)
the aborted branch runs `if (payload.aborted) return null` *before* the
content-persistence check, so the partial turn never reaches SQLite. The user
loses everything the model had produced up to the stop, and on the next turn
the model has no record of it either.

Both backends already hand the partial content to that single decision point:
- Claude: `finalizeStreamError` (`src/main/services/sessionManager.ts`) resolves the
  turn with `{ content: <partial>, aborted: true }`.
- PI: `streamingPI.ts` returns `{ content: accumulator.fullContent, aborted: true }`.

So the fix is concentrated in the shared `streamAndSave` abort branch.

**Goal:** persist the partial assistant message on manual stop, mark it as
interrupted so it is visually distinguishable, and keep the SDK/model state
consistent so the model "sees" the partial on the next turn.

This is the "Bug B" deliberately deferred from the
`2026-05-26` web-reconnect work — a separate code path (triggered only by an
explicit `messages:stop`) with its own design decision, now made.

## Decisions (confirmed with user)

- **Visual marker:** the saved partial renders as a normal assistant message
  with a discreet "interrupted" indicator (badge/label), not as an
  indistinguishable normal message.
- **Model memory:** after a stopped+saved turn, the SDK session is invalidated
  so the next turn rebuilds full history from SQLite (which now contains the
  partial). What the user sees == what the model knows.
- **Side effects:** a stopped turn does **not** fire the completion webhook or
  TTS — we do not announce/speak a half-finished response.
- **Empty stop:** if no content was generated (no text/thinking/tool calls),
  nothing is saved (no empty row).

## Design

### 1. Schema + migration — `src/core/db/schema.ts`

- Add `stopped INTEGER DEFAULT 0` to the `CREATE TABLE messages` definition
  (for fresh databases).
- Add an idempotent migration for existing databases:
  `applyMigration(db, columnsByTable, 'messages', 'stopped', 'INTEGER DEFAULT 0')`
  alongside the existing `messages.tool_calls` migration.

### 2. Types — `src/core/types/types.ts`

- Add `stopped: number` (0/1, SQLite boolean convention) to the `Message`
  interface. The renderer consumes the same shared type.

### 3. Persistence — `src/core/handlers/messages.ts`

In `streamAndSave`, replace the discard branch:

```ts
if (payload.aborted) return null
```

with a save-or-skip decision:

- `payload.aborted && hasContent(payload)` → `persistStoppedTurn(ctx, payload)`
- `payload.aborted` (no content) → `return null`

where `hasContent` is true when there is accumulated text/thinking content or
at least one tool call.

`persistTurnUsage` continues to run before this branch (unchanged) so token
usage is still recorded for stopped turns.

Add a dedicated helper `persistStoppedTurn(ctx, payload)` — **not** flags on
`persistAssistantTurn` (which would introduce per-caller conditionals in a
stable function). It performs:

1. `saveMessage(db, conversationId, 'assistant', content, [], toolCalls)` with
   the new `stopped = 1` flag (see §4).
2. `updateConversationTimestamp(db, conversationId)`.
3. `invalidateAllSessions(db, conversationId)` + `options.onSessionInvalidate?.(conversationId)`
   — reused from the regenerate/edit path; clears both `sdk_session_id`
   (Claude) and `pi_session_file` (PI).
4. `notifyConversationUpdated(conversationId)`.

It does **not** call `saveConversationSdkSessionId`, `fireWebhookCompletion`,
or `fireTts`.

### 4. saveMessage — `src/core/handlers/messages.ts`

Extend `saveMessage` with an optional `stopped = false` parameter that writes
the `stopped` column (0/1). Default false keeps every existing caller
unchanged.

### 5. Renderer marker

- Add `stopped: number` to the renderer `Message` type (shared from
  `core/types`).
- In the assistant-message rendering component, when `message.stopped` is
  truthy, render a discreet "Interrupted" marker below the message body, using
  existing theme CSS variables (e.g. `--color-text-muted`/`--color-warning`),
  consistent with existing badges. No new design system.

### 6. Recovery / ordering

`finalizeStreamError` (and the PI equivalent) send the `done` chunk with
`stopReason: 'aborted'` first; the renderer's `handleDone` clears the stream
buffer. `streamAndSave` then resolves, persists the stopped turn, and calls
`notifyConversationUpdated`. The existing `onConversationUpdated` listener
(buffer now cleared) reloads the conversation and the saved partial appears —
the same recovery mechanism used elsewhere, working in Electron and web.

## Out of scope

- Resuming/continuing a stopped partial in a later turn.
- Stops during `/compact` or auto-title generation (separate `summarizeWithModel`
  flow).

## Testing

- **messages handler:** aborted turn with content → assistant row saved with
  `stopped = 1` and tool calls; `invalidateAllSessions`/`onSessionInvalidate`
  called; `fireWebhookCompletion` and `fireTts` NOT called. Aborted turn with
  no content → no row saved (`return null`). Non-aborted turns unchanged.
- **schema:** `stopped` column exists on `messages` after migration; defaults
  to 0; existing rows backfill to 0.
- **renderer:** a message with `stopped = 1` renders the interrupted marker; a
  normal message does not.

## Verification (end-to-end)

1. `npm run build` clean; `npm test` (main + renderer) green.
2. Manual: start a long response, click Stop mid-stream. Expect the partial
   text to remain in the conversation with an "Interrupted" marker, persist
   across reload, and be visible to the model on the next turn.
