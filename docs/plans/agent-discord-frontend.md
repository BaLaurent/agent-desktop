# Agent: discord-frontend

## Scope
**WRITE:**
- `src/renderer/components/settings/DiscordSettings.tsx` (CREATE)
- `src/renderer/components/settings/DiscordSettings.test.tsx` (CREATE)
- `src/renderer/pages/SettingsPage.tsx` (EDIT — add Discord tab)

**READ:**
- `src/renderer/components/settings/WebServerSettings.tsx` — reference for lifecycle service UI
- `src/renderer/components/settings/GeneralSettings.tsx` — reference for toggle/input patterns
- `src/renderer/stores/settingsStore.ts` — understand `useSettingsStore` API
- `src/renderer/pages/SettingsPage.tsx` — understand categories array + component mapping
- `src/preload/api.d.ts` — understand `window.agent.discord.*` types

## Tasks

### Phase 2
- [ ] **TASK-030** — Create DiscordSettings UI component
  - **Depends on:** TASK-010 (settings keys whitelisted)
  - **File (CREATE):** `src/renderer/components/settings/DiscordSettings.tsx`
  - **Outputs:** Default-exported `DiscordSettings` React component

  **Design:**
  Follow `WebServerSettings.tsx` pattern. Three sections:

  **Section 1 — Enable Discord Bot**
  ```tsx
  <Toggle enabled={discord_enabled} onToggle={...} label="Enable Discord Bot" />
  ```
  Reads/writes `discord_enabled` setting.

  **Section 2 — Bot Token**
  ```tsx
  <input type={showToken ? 'text' : 'password'} value={discord_botToken} onChange={...} />
  <button onClick={() => setShowToken(!showToken)}>Show/Hide</button>
  ```
  Reads/writes `discord_botToken` setting. Only visible when enabled.

  **Section 3 — Connection Status**
  - Polls `window.agent.discord.status()` every 5 seconds when enabled
  - Shows: connected/disconnected indicator + bot username
  - Connect button: calls `window.agent.discord.connect()`
  - Disconnect button: calls `window.agent.discord.disconnect()`
  - Only visible when enabled and token is non-empty

  **Styling:**
  - Use CSS variables: `var(--color-text)`, `var(--color-text-muted)`, `var(--color-base)`
  - Row layout: `flex items-center justify-between py-3 border-b border-[var(--color-text-muted)]/10`
  - Wrapper: `<div className="space-y-6">`

  **Acceptance:**
  - Renders toggle, token input (with show/hide), connection status
  - Toggle saves `discord_enabled` setting
  - Token input saves `discord_botToken` setting
  - Connect/Disconnect buttons work
  - Status updates on poll interval
  - Disabled state when not enabled

### Phase 3
- [ ] **TASK-042** — Add Discord tab to SettingsPage
  - **Depends on:** TASK-030
  - **File (EDIT):** `src/renderer/pages/SettingsPage.tsx`
  - **Edit:**
    1. Add import: `import DiscordSettings from '../components/settings/DiscordSettings'`
    2. Add `'Discord'` to `categories` array (after `'Web Server'`, before `'Storage'`)
    3. Add `'Discord': DiscordSettings` to `categoryComponents` record
  - **Acceptance:** "Discord" tab visible in settings sidebar, clicking it renders DiscordSettings

### Phase 4
- [ ] **TASK-051** — Unit tests for DiscordSettings
  - **Depends on:** TASK-030
  - **File (CREATE):** `src/renderer/components/settings/DiscordSettings.test.tsx`
  - Mock `window.agent.discord` and `window.agent.settings`
  - **Test cases:**
    - Renders toggle with correct initial state
    - Toggle calls setSetting with correct key/value
    - Token input appears when enabled
    - Token input saves on change
    - Show/hide token toggle works
    - Connect button calls discord.connect()
    - Disconnect button calls discord.disconnect()
    - Status display shows bot username when connected
    - Status polling starts when enabled, stops when disabled
  - **Acceptance:** All tests pass, component interactions fully covered

## Phase Gates

| Phase | Gate |
|-------|------|
| Phase 2 | TASK-010 complete (setting keys whitelisted) |
| Phase 3 | TASK-030 complete (DiscordSettings component exists) |
| Phase 4 | TASK-030 complete (component exists to test) |
