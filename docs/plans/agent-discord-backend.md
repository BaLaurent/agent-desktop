# Agent: discord-backend

## Scope
**WRITE:**
- `src/main/services/discord.ts` (CREATE)
- `src/main/services/discord.test.ts` (CREATE)
- `src/main/ipc.ts` (EDIT — add import + registration call)
- `src/preload/index.ts` (EDIT — add discord namespace)
- `src/preload/api.d.ts` (EDIT — add discord types)

**READ:**
- `src/main/services/settings.ts` — understand ALLOWED_SETTING_KEYS pattern
- `src/main/services/webServer.ts` — reference for lifecycle service pattern (no db)
- `src/main/services/conversations.ts` — understand handler patterns
- `src/main/services/messages.ts` — understand messages:send return type
- `src/main/services/folders.ts` — understand folders:list return type
- `src/shared/types.ts` — Conversation, Message, Folder types
- `src/main/ipc.ts` — understand ipcDispatch, withSanitizedErrors, registerAllHandlers
- `src/preload/index.ts` — understand namespace pattern

## Tasks

### Phase 1 (blocking — done by orchestrator)
- [x] **TASK-010** — Add `discord_enabled`, `discord_botToken` to ALLOWED_SETTING_KEYS in settings.ts

### Phase 2
- [ ] **TASK-020** — Create Discord bot service (`src/main/services/discord.ts`)
  - **Depends on:** TASK-010
  - **Outputs:** `registerHandlers(ipcMain)`, internal `startBot()`, `stopBot()`, `getBotStatus()`
  - **Acceptance:**
    - Exports `registerHandlers` with signature `(ipcMain: IpcMain) => void`
    - Registers 3 IPC channels: `discord:connect`, `discord:disconnect`, `discord:status`
    - Creates discord.js Client with `Guilds` intent
    - Registers 4 slash commands on bot ready (global)
    - Autocomplete handlers query ipcDispatch for conversations/folders
    - `/send-message` uses `deferReply()` + `messages:send` via ipcDispatch
    - `/get-messages` uses `conversations:get` via ipcDispatch, extracts last N messages
    - `/new-conversation` uses `conversations:create` via ipcDispatch
    - Long responses split into 2000-char chunks
    - Active conversation tracked per Discord user in `Map<string, number>`

### Phase 3
- [ ] **TASK-040** — Register Discord in ipc.ts
  - **Depends on:** TASK-020
  - **Edit:** In `registerAllHandlers`, add:
    ```typescript
    import { registerHandlers as discordHandlers } from './services/discord'
    // In registerAllHandlers body:
    discordHandlers(safeIpc)
    ```
  - **Acceptance:** `discord:connect`, `discord:disconnect`, `discord:status` exist in ipcDispatch

- [ ] **TASK-041** — Add Discord to preload bridge
  - **Depends on:** TASK-040
  - **Edit `src/preload/index.ts`:** Add discord namespace:
    ```typescript
    discord: {
      connect: () => withTimeout(ipcRenderer.invoke('discord:connect')),
      disconnect: () => withTimeout(ipcRenderer.invoke('discord:disconnect')),
      status: () => withTimeout(ipcRenderer.invoke('discord:status')),
    },
    ```
  - **Edit `src/preload/api.d.ts`:** Add to AgentAPI:
    ```typescript
    discord: {
      connect(): Promise<void>
      disconnect(): Promise<void>
      status(): Promise<{ connected: boolean; username?: string; guildCount?: number }>
    }
    ```
  - **Acceptance:** `window.agent.discord.*` methods typed and callable

- [ ] **TASK-043** — Auto-start bot on app launch
  - **Depends on:** TASK-040
  - **Edit `src/main/services/discord.ts`:** After IPC handler registration, check settings and auto-start
  - **Acceptance:** Bot connects automatically when `discord_enabled === 'true'` and token present

### Phase 4
- [ ] **TASK-050** — Unit tests for Discord service
  - **Depends on:** TASK-020
  - **File:** `src/main/services/discord.test.ts`
  - Mock `discord.js` Client, mock `ipcDispatch`
  - **Test cases:**
    - registerHandlers registers 3 IPC channels
    - connect reads token from settings, creates Client, logs in
    - disconnect destroys Client
    - status returns correct state
    - autocomplete filters conversations by partial title match
    - autocomplete filters folders by partial name match
    - `/set-conversation` stores active conversation for user
    - `/send-message` calls deferReply + messages:send + editReply
    - `/get-messages` returns formatted messages
    - `/new-conversation` creates conversation + sets active
    - Long messages split at 2000 chars
  - **Acceptance:** All tests pass, service logic fully covered

## Phase Gates

| Phase | Gate |
|-------|------|
| Phase 2 | TASK-010 complete (setting keys whitelisted) |
| Phase 3 | TASK-020 complete (discord.ts exists with registerHandlers export) |
| Phase 4 | TASK-020 + TASK-040 complete (service exists and is wired) |
