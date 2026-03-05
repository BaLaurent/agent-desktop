# Implementation Plan: Discord Bot Integration

## Overview
- **Goals:** Interact with Agent Desktop conversations via Discord slash commands — set active conversation, get messages, send messages (with AI response), create new conversations
- **Constraints:** Uses `ipcDispatch` for all data access (no direct DB in discord service), discord.js v14+, Discord 2000-char message limit, autocomplete max 25 choices
- **Tech stack:** discord.js, Electron IPC (`ipcDispatch`), existing services (conversations, messages, folders)

## Research Summary

### Codebase Conventions
- File structure: services in `src/main/services/*.ts`, each exports `registerHandlers(ipcMain, db?)`
- Settings: flat `feature_subkey` strings in `ALLOWED_SETTING_KEYS` set (`src/main/services/settings.ts`)
- IPC: `withSanitizedErrors` wrapper auto-mirrors handlers into `ipcDispatch` Map
- Preload: `src/preload/index.ts` exposes `window.agent.<namespace>` via `contextBridge`
- Types: `src/preload/api.d.ts` declares `AgentAPI` interface
- UI settings: `src/renderer/pages/SettingsPage.tsx` — `categories` const array + `categoryComponents` record

### Dependencies & Stack
- **Installed:** ws, electron, react 18, zustand, sql.js, better-sqlite3 types
- **Missing (will need):** `discord.js` (v14+)

### Existing Code to Integrate With
- `ipcDispatch` (`src/main/ipc.ts` line 7) — Map of all IPC handlers callable from main process
- `conversations:list` — returns all conversations (id, title, folder_id, ...)
- `conversations:get` — returns ConversationWithMessages (includes `.messages[]`)
- `conversations:create` — creates conversation, returns it
- `messages:send` — saves user message + streams AI response, returns assistant Message
- `folders:list` — returns all folders (id, name, parent_id, ...)
- `settings:get` / `settings:set` — flat KV store, all values are strings
- Settings UI pattern: `WebServerSettings.tsx` (toggle + status pattern, closest model)

### Open Questions
None — all critical paths verified.

## Dependency Graph

```
Phase 0: install discord.js
    ↓
Phase 1: add setting keys to ALLOWED_SETTING_KEYS
    ↓
Phase 2 (parallel):
  ├── Agent backend: create discord.ts service
  └── Agent frontend: create DiscordSettings.tsx
    ↓
Phase 3: integration wiring (ipc.ts, preload, SettingsPage.tsx)
    ↓
Phase 4: tests
```

## Phases

### Phase 0 — Dependencies

**TASK-001** — Install discord.js
- `npm install discord.js`
- No other deps needed (discord.js bundles its own WS and REST)

### Phase 1 — Settings Keys (blocker for Phase 2)

**TASK-010** — Add Discord setting keys to whitelist
- **File:** `src/main/services/settings.ts`
- **Edit:** Add to `ALLOWED_SETTING_KEYS` set:
  ```
  'discord_enabled',
  'discord_botToken',
  ```
- **Acceptance:** Keys accepted by `settings:set` handler without rejection

### Phase 2 — Core Implementation (parallel)

#### Agent: discord-backend

**TASK-020** — Create Discord bot service
- **File (CREATE):** `src/main/services/discord.ts`
- **Depends on:** TASK-010 (settings keys exist)
- **Outputs:** `registerHandlers(ipcMain)`, `startBot(token)`, `stopBot()`, `getBotStatus()`

**Design:**

```typescript
// State
let client: Client | null = null
const activeConversations = new Map<string, number>() // discordUserId → conversationId

// 4 slash commands registered on bot ready (global commands)
// Each with autocomplete where applicable

// IPC handlers:
//   discord:connect  — starts bot with token from settings
//   discord:disconnect — stops bot
//   discord:status — returns { connected, username, guildCount }
```

**Slash commands:**

| Command | Options | Autocomplete | Behavior |
|---------|---------|-------------|----------|
| `/set-conversation` | `conversation` (required) | conversations:list → filter by input | Stores conversationId in activeConversations map |
| `/get-messages` | `conversation` (optional), `count` (int, default 10) | conversations:list | Fetches via conversations:get, formats last N messages |
| `/send-message` | `message` (required), `conversation` (optional) | conversations:list | deferReply → messages:send via ipcDispatch → editReply with response |
| `/new-conversation` | `folder` (required), `title` (optional) | folders:list | conversations:create → sets as active → replies with confirmation |

**Key behaviors:**
- `messages:send` via ipcDispatch triggers full AI streaming — use `interaction.deferReply()` (15 min timeout)
- Long responses split into 2000-char chunks sent as follow-up messages
- Autocomplete filters by partial match on title/name, returns max 25 choices
- Bot auto-starts on app launch if `discord_enabled === 'true'` and token exists
- Bot reconnects on token change via `discord:connect`

**Acceptance:** Bot connects, registers commands, autocomplete returns data, commands execute correctly

#### Agent: discord-frontend

**TASK-030** — Create Discord settings UI component
- **File (CREATE):** `src/renderer/components/settings/DiscordSettings.tsx`
- **Depends on:** TASK-010 (settings keys exist)
- **Outputs:** `DiscordSettings` React component

**Design:**
- Follow `WebServerSettings.tsx` pattern (closest model — lifecycle service with connect/disconnect)
- Sections:
  1. **Enable Discord Bot** — Toggle (`discord_enabled`)
  2. **Bot Token** — Password input (`discord_botToken`) with show/hide toggle
  3. **Connection Status** — Shows connected/disconnected + bot username + Connect/Disconnect button
- Status polling: call `window.agent.discord.status()` on interval (5s) when enabled
- Connect button calls `window.agent.discord.connect()`
- Disconnect button calls `window.agent.discord.disconnect()`

**Acceptance:** Component renders, toggles save settings, connect/disconnect work, status displays

### Phase 3 — Integration Wiring

**TASK-040** — Register Discord handlers in IPC
- **File (EDIT):** `src/main/ipc.ts`
- **Edit:** Import `registerHandlers as discordHandlers` from `./services/discord`, call `discordHandlers(safeIpc)` in `registerAllHandlers` (no db needed)
- **Depends on:** TASK-020
- **Acceptance:** `discord:*` channels available in ipcDispatch

**TASK-041** — Add Discord namespace to preload bridge
- **File (EDIT):** `src/preload/index.ts`
- **Edit:** Add `discord` namespace to api object:
  ```typescript
  discord: {
    connect: () => withTimeout(ipcRenderer.invoke('discord:connect')),
    disconnect: () => withTimeout(ipcRenderer.invoke('discord:disconnect')),
    status: () => withTimeout(ipcRenderer.invoke('discord:status')),
  },
  ```
- **File (EDIT):** `src/preload/api.d.ts`
- **Edit:** Add to `AgentAPI` interface:
  ```typescript
  discord: {
    connect(): Promise<void>
    disconnect(): Promise<void>
    status(): Promise<{ connected: boolean; username?: string; guildCount?: number }>
  }
  ```
- **Depends on:** TASK-040
- **Acceptance:** `window.agent.discord.*` methods callable from renderer

**TASK-042** — Add Discord tab to SettingsPage
- **File (EDIT):** `src/renderer/pages/SettingsPage.tsx`
- **Edit:**
  1. Import `DiscordSettings` from `../components/settings/DiscordSettings`
  2. Add `'Discord'` to `categories` array (after 'Web Server', before 'Storage')
  3. Add `'Discord': DiscordSettings` to `categoryComponents`
- **Depends on:** TASK-030
- **Acceptance:** Discord tab visible in settings, renders DiscordSettings component

**TASK-043** — Auto-start Discord bot on app launch
- **File (EDIT):** `src/main/services/discord.ts` (already owned by backend agent)
- **Edit:** In `registerHandlers`, after registering IPC handlers, read settings and auto-start:
  ```typescript
  // Auto-start if enabled
  const settings = db is not available, so read via ipcDispatch
  const allSettings = await ipcDispatch.get('settings:get')!()
  if (allSettings.discord_enabled === 'true' && allSettings.discord_botToken) {
    startBot(allSettings.discord_botToken).catch(err => console.error('Discord auto-start failed:', err))
  }
  ```
- **Depends on:** TASK-020, TASK-040
- **Acceptance:** Bot auto-connects on app startup when enabled with valid token

### Phase 4 — Tests

**TASK-050** — Unit tests for Discord service
- **File (CREATE):** `src/main/services/discord.test.ts`
- **Depends on:** TASK-020
- Mock discord.js Client, mock ipcDispatch
- Test: registerHandlers creates 3 IPC channels
- Test: connect/disconnect lifecycle
- Test: autocomplete returns filtered results
- Test: command handlers call correct ipcDispatch channels
- Test: long messages are split into 2000-char chunks
- Test: active conversation tracking (set/get per user)

**TASK-051** — Unit tests for DiscordSettings component
- **File (CREATE):** `src/renderer/components/settings/DiscordSettings.test.tsx`
- **Depends on:** TASK-030
- Mock window.agent.discord and window.agent.settings
- Test: renders toggle, token input, status display
- Test: toggle saves discord_enabled setting
- Test: connect button calls discord.connect()
- Test: status display updates

## Interface Contracts

### Discord service → IPC channels consumed (via ipcDispatch)

| Channel | Args | Returns | Used by |
|---------|------|---------|---------|
| `settings:get` | (none) | `Record<string, string>` | Auto-start check |
| `conversations:list` | (none) | `Conversation[]` | Autocomplete for conversation selection |
| `conversations:get` | `(id: number)` | `ConversationWithMessages` | `/get-messages` |
| `conversations:create` | `(data: { title, folder_id })` | `Conversation` | `/new-conversation` |
| `messages:send` | `(conversationId: number, content: string)` | `Message` | `/send-message` |
| `folders:list` | (none) | `Folder[]` | Autocomplete for folder selection |

### Discord service → IPC channels exposed

| Channel | Args | Returns | Used by |
|---------|------|---------|---------|
| `discord:connect` | (none) | `void` | DiscordSettings UI |
| `discord:disconnect` | (none) | `void` | DiscordSettings UI |
| `discord:status` | (none) | `{ connected: boolean; username?: string; guildCount?: number }` | DiscordSettings UI |

### Preload bridge additions

```typescript
// window.agent.discord
{
  connect(): Promise<void>
  disconnect(): Promise<void>
  status(): Promise<{ connected: boolean; username?: string; guildCount?: number }>
}
```

## Critical Path

```
install discord.js → settings keys → discord.ts service → ipc.ts wiring → preload bridge → auto-start
```

The frontend (DiscordSettings.tsx + SettingsPage.tsx) runs in parallel with the backend but is not on the critical path — the bot can function without the UI (via auto-start with pre-set settings).

## File Ownership Summary

| File | Owner | Action |
|------|-------|--------|
| `src/main/services/discord.ts` | backend | CREATE |
| `src/main/services/discord.test.ts` | backend | CREATE |
| `src/main/services/settings.ts` | phase-1 | EDIT (2 keys) |
| `src/main/ipc.ts` | backend | EDIT (import + call) |
| `src/preload/index.ts` | backend | EDIT (namespace) |
| `src/preload/api.d.ts` | backend | EDIT (types) |
| `src/renderer/components/settings/DiscordSettings.tsx` | frontend | CREATE |
| `src/renderer/components/settings/DiscordSettings.test.tsx` | frontend | CREATE |
| `src/renderer/pages/SettingsPage.tsx` | frontend | EDIT (tab) |
