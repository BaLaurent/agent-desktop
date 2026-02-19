# Agent Desktop — Project Instructions

## Build & Run
- `npm run dev` — start dev server with hot reload
- `npm run build` — compile TypeScript (output: `out/`)
- `npm run dist:linux` — package AppImage + deb (output: `release/`)

## Architecture
- Electron + React + Zustand + Tailwind + SQLite (better-sqlite3)
- Build tool: electron-vite (outputs to `out/`, not `dist-electron/`)
- IPC: each service in `src/main/services/` exports `registerHandlers(ipcMain, db)`
- Preload: `contextBridge.exposeInMainWorld('agent', api)` — typed via `src/preload/api.d.ts`
- Renderer types: `src/renderer/env.d.ts` references preload types for `window.agent`

## Key Conventions
- CSS: `@import` before `@tailwind` directives; themes via CSS custom properties
- Auth: OAuth credentials from `claude login` CLI, NOT api_key
- DB: SQLite WAL mode, at `~/.config/agent-desktop/agent.db`
- Vite 5.x required (electron-vite peer dep)
- **asar: false** in electron-builder.yml — required because Agent SDK resolves `cli.js` via `import.meta.url` which lands inside `app.asar`; system `node` cannot read asar archives

## Theming System
- CSS custom properties (`--color-*`) in theme `.css` files at `~/.agent-desktop/themes/`; Tailwind maps to them in `tailwind.config.ts`
- **Naming gotcha**: `base` (not `bg`), `body` (not `text`), `contrast` (not `text-contrast`) — avoids Tailwind collisions like `bg-bg` or `text-text`
- **Tinting gotcha**: `color-mix(in srgb, var(--color-*) N%, transparent)` — Tailwind opacity modifiers don't work with raw CSS var values
- No hardcoded hex in renderer; `style={{ backgroundColor }}` only for dynamic runtime values (theme swatches)
- Built-in themes (`default-dark.css`, `default-light.css`) seeded by `ensureThemeDir()`; theme editor in Settings > Appearance

## File Explorer & Viewers
- Two backend functions in `src/main/services/files.ts` — understand which to use:
  - `files:listDir` — flat single-level, no recursion, no skip list, only hides `.` prefix. Used by file explorer tree
  - `files:listTree` — recursive DFS (MAX_DEPTH=10, MAX_FILES=500, configurable exclude list). Used only by `@mention` autocomplete
- `files_excludePatterns` setting (comma-separated dir names) cascades via AI overrides; defaults in `constants.ts`
- Viewers: Monaco (code), sandboxed iframe (HTML), react-markdown (MD), MermaidBlock (.mmd), DOMPurify-sanitized SVG, image preview (base64 data URL)
- Images read as binary → base64 with `language: 'image'`; SVGs rendered inline (not raw code)
- No file size limits on `readFile`; `MAX_PASTE_SIZE = 5MB` only for clipboard paste
- Auto-refresh on stream finish; `artifacts` table left inert (no migration needed)
- Theme apply: when CWD is `~/.agent-desktop/themes/`, `.css` files show Apply/Active buttons
- Context menu: Open Default App, Reveal, Copy Path, Rename (inline), Duplicate, Move to Trash
- `@mention` uses VS Code-style fuzzy matching (`src/renderer/utils/fuzzyMatch.ts`)
- **Expand button**: "Expand" button routes to `CodeEditorModal` (source/code mode) or `PreviewModal` (preview/images); visible for all file types
- **Markdown anchor links**: headings get slugified `id` attributes; `#` links scroll within container instead of calling `openExternal`
  - **Gotcha**: browser URL-encodes accented chars in href (`é` → `%C3%A9`) — must `decodeURIComponent` before slugifying
  - **Gotcha**: `slugify` uses Unicode `\p{L}\p{N}` (not `\w`) to preserve accented characters

## CWD & Working Directory
- Each conversation has `cwd` column (nullable, defaults to `~/.agent-desktop/sessions-folder/{id}/`)
- **Gotcha**: `getAISettings()` must be called BEFORE `getSystemPrompt()` — CWD is needed for prompt injection
- CWD injected into system prompt as directive so agent writes files there
- Folders have `default_cwd` column — applied to new conversations created inside the folder
- `FolderSettingsPopover` combines AI overrides + default CWD in one popover ("Folder Settings" context menu)

## AI Settings & Cascade
- All AI settings stored in `settings` table; `AISettings` interface in `streaming.ts`
- **Cascade**: `ai_overrides TEXT` (JSON) on both `folders` and `conversations` — priority: Conversation > Folder > Global
- `null` / `{}` = inherited. Only overridden keys present in JSON
- **System prompt cascade**: conversation `system_prompt` column > conv `ai_overrides` > folder `ai_overrides` > global setting
- **NOT cascaded** (per-conversation only): `cwd`, `kb_enabled`, `cleared_at`
- **Permission Mode**: `ai_permissionMode` setting; `allowDangerouslySkipPermissions` only set when `bypassPermissions`
- **Allowed Tools**: `ai_tools` = `'preset:claude_code'` (all) or JSON array; see `SDK_TOOLS` in `src/main/services/tools.ts`
- **Setting Sources** (was "Skills"): `ai_skills` = `'off'`|`'user'`|`'project'`|`'local'`; controls `settingSources` for SDK (settings.json, CLAUDE.md, commands, hooks, skills)
  - `'user'` → `['user']`, `'project'` → `['user','project']`, `'local'` → `['user','project','local']`
  - **Skills toggle** (`ai_skillsEnabled`): independent of setting sources — controls whether `'Skill'` is added to `allowedTools`
  - **Per-skill disable** (`ai_disabledSkills`): JSON `string[]` of skill names; denied in `canUseTool` BEFORE bypass mode check
  - `'user'` discovers `~/.claude/skills/`, `'project'`/`'local'` also discovers `.claude/skills/` in CWD
- **maxTurns**: 0 = unlimited (SDK receives `undefined`); no upper cap in UI
- Overrideable keys: `ai_model`, `ai_maxTurns`, `ai_maxThinkingTokens`, `ai_maxBudgetUsd`, `ai_permissionMode`, `ai_tools`, `ai_defaultSystemPrompt`, `ai_mcpDisabled`, `ai_skillsEnabled`, `ai_disabledSkills`, `files_excludePatterns`
- **System prompt editor**: `SystemPromptEditorModal` — full-screen Monaco editor modal, shared by global AI settings and folder/conversation override forms ("Expand" button on textarea fields)
- See `src/shared/constants.ts` for `SETTING_DEFS`, `MODEL_OPTIONS`, `PERMISSION_OPTIONS`

## MCP Servers
- Transport types: `stdio` (default), `http`, `sse` — stored in `type` column on `mcp_servers` table
- `getAISettings()` builds transport-specific SDK configs; `streaming.ts` generates `allowedTools` wildcards (`mcp__<name>__*`)
- **Gotcha**: `allowedTools` wildcards are REQUIRED — without them, MCP tools are unusable even with `bypassPermissions`
- **Name validation**: server names must not contain `__` (conflicts with SDK tool naming `mcp__name__tool`)
- **Args input**: dynamic list per arg; `flatMap(s => s.trim().split(/\s+/))` on save auto-splits `--flag value` into tokens
- Test Connection: 10s timeout, 4KB output cap; IPC timeout 15s (> backend 10s to avoid masking)
- Status: derived from `enabled` field only — no runtime connection tracking (SDK manages connections)
- Per-conversation MCP: `ai_mcpDisabled` key in `ai_overrides` — JSON array of disabled server names (negative list)
- Default (absent key) = all enabled servers active; new servers auto-active unless explicitly disabled

## Streaming & Tool Use
- **Stub-then-enrich pattern**: `streaming.ts` uses `Map<string, ToolCall>` — `content_block_start` creates stub, `input_json_delta` accumulates, `content_block_stop` finalizes, `result` enriches with output
- `StreamPart` union: `text` | `tool` (running/done) | `tool_approval` | `ask_user` | `mcp_status`
- **Stream isolation**: `streamBuffers: Record<number, StreamPart[]>` — dict keyed by conversationId; N conversations stream simultaneously
- **"Streaming" state**: a conversation is streaming iff its ID is a key in `streamBuffers` (no separate flag)
- View/buffer separation: `streamParts`/`streamingContent` are views synced from `streamBuffers[activeConversationId]`
- **Guard**: `isLoading && !isStreaming` in `MessageList` prevents loading skeleton from hiding `StreamingIndicator`
- Chunks without `conversationId` fall back to `activeConversationId` (backward compat)
- Conversation history: `buildPromptWithHistory()` wraps prior messages in `<conversation_history>` XML tags; current message placed outside
- **Persistence**: `tool_calls TEXT` column on messages; `streamMessage()` returns `{ content, toolCalls, aborted }`

## Tool Approval & AskUserQuestion
- `canUseTool` callback is **always set**, regardless of permission mode
- **AskUserQuestion**: always intercepted interactively (sends `ask_user` chunk, awaits user answer)
- **Bypass mode**: `allowDangerouslySkipPermissions = true` alongside `canUseTool`; non-AskUserQuestion tools auto-approved
- `askUserToolIds: Set<string>` suppresses AskUserQuestion from tool visualization pipeline (no tool_start/result chunks)
- Deferred Promise pattern: callback creates Promise in `pendingRequests` Map, sends chunk, awaits response via `respondToApproval()`
- **Edge case**: `abortStream()` and `finally` block both call `denyAllPending()` to resolve all pending with deny

## Knowledge Base
- **Source of truth**: `~/.agent-desktop/knowledges/` directory — sub-folders are "collections"
- Per-conversation selection via `ai_knowledgeFolders` key in `ai_overrides` (JSON `KnowledgeSelection[]`); cascades like `ai_mcpDisabled`
- System prompt injection: `getSystemPrompt()` reads collections, injects with `--- Knowledge [{access}]: {collection}/{file} ---` markers
- **500KB cumulative size guard** — files beyond limit are skipped
- `readwrite` collections: add write-access directive + paths passed as additional writable paths to CWD hooks
- `isPathOutsideAllowed()` generalizes single-CWD check to multi-root (CWD + writable KB paths)
- DB tables `knowledge_files`, `conversation_knowledge` left inert (no destructive migration)

## File Attachments
- Attach via paperclip, drag-and-drop, or Ctrl+V paste (images/files from clipboard)
- **Copy-to-session**: files copied to `{cwd}/attachments/` with dedup naming; markdown links appended to message content
- **File path API**: `webUtils.getPathForFile(file)` via preload — replaces unsafe `(file as any).path`
- Paste: 5MB limit, saved to `os.tmpdir()/agent-paste/` with unique filename

## Slash Commands
- Type `/` in chat input to open autocomplete dropdown with fuzzy filtering
- **`/clear`**: sets `cleared_at` timestamp on conversation — messages before it stay visible in UI but are excluded from AI prompt history via `buildMessageHistory()` filter. `ContextClearedDivider` renders at the boundary in `MessageList`
- Backend: `src/main/services/commands.ts` scans directories in priority order (later overrides earlier):
  1. **Builtin**: `compact`, `clear`, `help`
  2. **User**: `~/.claude/commands/*.md` (frontmatter `description:`)
  3. **Project**: `{cwd}/.claude/commands/*.md`
  4. **Skills**: `~/.claude/skills/*/SKILL.md` and `{cwd}/.claude/skills/*/SKILL.md` (only when `ai_skills` ≠ `'off'`)
- Uses `Map<string, SlashCommand>` for dedup — same-name commands replaced by higher-priority source
- Frontmatter parsing: reads first 2KB, supports plain, quoted, and YAML folded block (`>`) descriptions
- `SlashCommandDropdown` mirrors `FileMentionDropdown` pattern (position, fuzzy match, keyboard nav, click-outside)
- **Gotcha**: `commands:list` IPC does NOT need `db` — registered like `themes`/`system` (no db param)

## Chat UI
- **Layout gotcha**: `FileDropZone` wrapper must have `flex-1 flex flex-col overflow-hidden`; `MessageList` uses `overflow-y-auto` inner div
- **ChatStatusLine**: below input — model dropdown (writes `ai_model` override), permission label, MCP toggle, KB dropdown
- **Sidebar**: unified tree in `FolderTree.tsx`; DnD conversations onto folders; folder delete offers "Delete all" vs "Keep conversations"
- **Code blocks**: auto-collapsed >10 lines, expanded <=10; `defaultCollapsed` prop overrides
- **Markdown**: `react-markdown` + `remark-gfm` (NO `rehype-highlight`); `extractText()` required because children can be element arrays, not strings — without it, code blocks render `[object Object]`
- **General Settings**: `sendOnEnter`, `autoScroll`, `minimizeToTray`, `notificationSounds` — behavior in setting name

## Quick Chat
- Global overlay (Alt+Space / Alt+Shift+Space) for quick agent interactions from anywhere on the desktop
- Frameless, transparent, always-on-top BrowserWindow; loads same renderer with `?mode=overlay&voice={bool}` query params
- Dedicated conversation persisted via `quickChat_conversationId` in settings table; auto-created on first use
- Overlay components in `src/renderer/components/overlay/` — `OverlayChat` (container), `OverlayInput`, `OverlayResponse`, `OverlayVoice`
- Settings in `QuickChatSettings.tsx`: response notification toggle, response bubble toggle, purge history
- **Gotcha**: shortcut re-toggle while visible → voice mode sends `overlay:stopRecording`, text mode hides; only creates new window if hidden/destroyed
- **Gotcha**: `hideOverlay()` calls `destroy()` not `hide()` — `headlessActive` only resets on `closed` event; `hide()` created zombie windows that blocked subsequent shortcut activations
- **Gotcha**: `OverlayChat` must also listen for `overlay:stopRecording` (when `voiceSent=true`) — after transcription, `OverlayVoice` unmounts and its listener is cleaned up; without the fallback listener the overlay gets stuck
- **Gotcha**: `ready-to-show` never fires for transparent BrowserWindows on Linux/Wayland — must use `webContents.did-finish-load` instead
- **Gotcha**: overlay must use `h-screen` not `h-full` — `html`/`body`/`#root` lack `height: 100%`, so `h-full` resolves to `auto` and breaks `overflow-y-auto` scrolling

## Audio Ducking
- `src/main/utils/volume.ts` — auto-lowers system volume during Quick Voice recording
- Backend detection: `wpctl` > `pactl` > `amixer` (cached after first lookup via `findBinaryInPath()`)
- **Subtractive model**: setting `voice_volumeDuck` = 30 means "reduce by 30 points" (80% → 50%), clamped at 0
- Duck on `showOverlay('voice')` (fire-and-forget), restore on overlay `closed` event
- **Double-duck guard**: `savedVolume !== null` prevents overwriting the original volume on rapid re-trigger
- Silent on error (log + skip, never throw) — same pattern as `hyprctl()` in `waylandShortcuts.ts`
- Setting: `voice_volumeDuck` in settings table; slider in Settings > Quick Chat > Voice Volume

## Global Shortcuts (Wayland/X11)
- Hybrid routing in `globalShortcuts.ts`: `getSessionType()` → X11 uses Electron `globalShortcut.register()`, Wayland uses XDG Desktop Portal
- Session detection priority: `XDG_SESSION_TYPE` > `WAYLAND_DISPLAY` > `DISPLAY` (both can be set under XWayland)
- Wayland: `dbus-next` (pure JS) → `CreateSession` → `BindShortcuts` → `Activated` signal via raw `AddMatch` + bus message handler
- **Gotcha**: `bus.name` is null until D-Bus Hello handshake completes — must `await bus.once('connect')` before accessing
- **Gotcha**: `getProxyObject()` fails on portal Request paths — Hyprland doesn't expose `org.freedesktop.portal.Request` for introspection
- **Gotcha**: do NOT include `preferred_trigger` in `BindShortcuts` — Hyprland portal ignores/warns on unknown data types
- **Hyprland shortcut dispatch**: uses FIFO (named pipe) at `$XDG_RUNTIME_DIR/agent-desktop-shortcuts.pipe` + `hyprctl keyword bind MODS,key,exec,echo ID > pipe`. D-Bus `Activated` signals from the portal never work in Electron's event loop (`dbus-next` signal delivery is broken). Non-Hyprland compositors (GNOME/KDE) still use the portal D-Bus path.
- **Gotcha**: FIFO must be opened with `O_RDWR` only (no `O_NONBLOCK`) — `O_NONBLOCK` causes `EAGAIN` errors with `createReadStream`; `O_RDWR` alone prevents blocking on `open()` and prevents EOF when writers disconnect
- **Gotcha**: always `unbind` before `bind` in hyprctl — `keyword bind` accumulates at runtime; app restarts without compositor restarts leave stale bindings
- **Gotcha**: re-registration keeps FIFO alive and only updates hyprctl binds — `rebindWaylandShortcuts()` avoids teardown/rebuild
- Keybindings read from `keyboard_shortcuts` table (actions `quick_chat`, `quick_voice`, `show_app`); re-registered via `quickChat:reregisterShortcuts` IPC
- Supported compositors: KDE Plasma 5.27+, Hyprland, GNOME 47+; fallback: log warning, tray menu still works

## Keyboard Shortcuts & Deep Links
- Dynamic shortcuts stored in `keyboard_shortcuts` table; parsed via `shortcutMatcher.ts`
- **Modifier handling**: `Ctrl` and `Super` (metaKey) are independent modifiers — NOT conflated via `CommandOrControl`
  - `parseAccelerator()`: `CommandOrControl`/`Ctrl`/`Control` → `ctrl`; `Super`/`Meta`/`Command`/`Cmd` → `meta`; `Option` → `alt`
  - `matchesEvent()`: checks `ctrlKey` and `metaKey` separately (no `||`)
  - `keyEventToAccelerator()`: records `Ctrl` and `Super` as separate parts
  - `formatKeybinding()`: converts legacy `CommandOrControl` → `Ctrl` for display
  - **Backward compat**: existing DB entries with `CommandOrControl` still parse correctly (maps to `ctrl`)
- Global shortcuts (`quick_chat`, `quick_voice`, `show_app`) in same table; `ShortcutSettings.tsx` splits App vs Global sections with Wayland banner
- Deep link: `agent://conversation/{id}`; tray "New Conversation" sends `tray:newConversation` IPC

## Auto-Title Generation
- Uses Haiku via Agent SDK with `tools: []` and `maxTurns: 1` (fire-and-forget after first response)
- Works even on `error_max_turns` — assistant messages yielded before error
- **Gotcha**: `outputFormat: json_schema` was removed — causes SDK internal tool_use cycle that exhausts `maxTurns: 1`

## Voice Input (Whisper CPP)
- Local speech-to-text: user installs whisper.cpp binary, Agent spawns it (30s timeout)
- WAV encoder: MediaRecorder webm → AudioContext → 16kHz mono PCM WAV (`wavEncoder.ts`)
- Advanced params: sparse JSON persistence (only non-default values stored); `buildAdvancedArgs()` emits CLI flags
- **Auto-send**: `whisper_autoSend` setting — transcribed text sent immediately; `externalText` set to `undefined` to prevent double injection
- `MessageInput` accepts `externalText` prop for text injection with smart separator
- IPC timeout: 45s (> 30s backend timeout); keyboard shortcut: `Ctrl+Shift+V`
- `seedShortcuts` uses `INSERT OR IGNORE` (existing users get new shortcuts without reset)

## Security
- **SVG sanitization**: DOMPurify — `USE_PROFILES: { svg: true }`, forbids `script`, `foreignObject`, `use`
- **HTML sandbox**: `sandbox=""` (maximum restriction); JS permission banner with trust levels (once/folder/all)
- **URL whitelist**: `system:openExternal` only allows `http:`/`https:` protocols
- **Path traversal**: `validatePathSafe()` blocks `/proc`, `/sys`, `/dev`, `/boot`, `/sbin`, `/etc`
- **MCP command injection**: `DANGEROUS_CHARS` regex validates command field against shell metacharacters
- **IPC validation**: `validateString`, `validatePositiveInt`, `validatePathSafe` on all handler entry points
- **CWD restriction hooks** (`cwdHooks.ts`): PreToolUse hook denies writes outside CWD
  - **Gotcha**: must use `'deny'` not `'ask'` — bypass mode auto-approves `'ask'` decisions
  - Tilde expansion: `~/path` → `$HOME/path` before path resolution
  - Bash: best-effort regex extraction of write targets (redirections, tee, cp, mv, mkdir, touch, ln, rsync)
  - Setting: `hooks_cwdRestriction` (default `'true'`), cascades via overrides
- **Async I/O**: all `readFileSync`/`statSync` on main thread converted to `fs.promises.*`
- **Per-conversation abort**: `Map<number, AbortController>` replaces single global scalar
- **DB indexes**: `idx_messages_created_at`, `idx_folders_parent`; CWD cache FIFO limit: 1000

## AppImage & Auth
- `enrichEnvironment()` in `src/main/utils/env.ts` — called at startup (before `app.whenReady()`)
- **AppImage gotcha**: `sanitizeAppImageEnv()` removes `/tmp/.mount_*` paths from `LD_LIBRARY_PATH` so child processes don't load Electron's bundled `.so` files
- Auth pre-checks `~/.claude/.credentials.json` existence before SDK call (fast fail); diagnostics panel on failure
- **Root cause** of asar issue: SDK resolves `cli.js` via `import.meta.url` → lands inside `app.asar` → system `node` can't read asar. Fix: `asar: false`

## Auto-Update (electron-updater)
- Uses `electron-updater` with GitHub Releases as update source; `publish` config in `electron-builder.yml`
- `initAutoUpdater(getWindow, onUpdateReady)` — wires events, first check after 10s, then every 4h
- `autoDownload = false` (user must opt-in via UI), `autoInstallOnAppQuit = true`
- IPC: `updates:check`, `updates:download`, `updates:install`, `updates:getStatus` — no db needed (registered like themes/commands)
- Real-time status via `updates:status` event to renderer (`UpdateStatus` discriminated union: idle/checking/available/downloading/downloaded/error)
- **deb detection**: `process.platform === 'linux' && !process.env.APPIMAGE` → `shell.openExternal` to GitHub releases (deb doesn't support delta updates)
- **Guard**: `app.isPackaged` check — updater not initialized in dev mode
- Native `Notification` on update-available and update-downloaded
- Tray wired via `setTrayUpdateCallbacks(checkForUpdates, installUpdate)` from `index.ts` to avoid circular imports
- `autoUpdater.logger = null` — suppresses verbose console logging (stack traces on check failure)
- **Gotcha**: 404 for `latest-linux.yml` is expected when no release metadata exists; error handler treats it as `not-available` instead of showing an error
- **Publishing**: releases must use `electron-builder --publish always` to auto-generate and upload `latest-linux.yml`; manual AppImage uploads won't include update metadata
- AboutSection subscribes to `onStatus()` for real-time UI (progress bar, state-specific buttons)

## Tray
- `createTray(getWindow, ensureWindow)` — stores closures at module scope for dynamic menu rebuilds
- `setTrayUpdateCallbacks(onCheck, onInstall)` — wires update actions; `rebuildTrayMenu(updateReady)` swaps "Check for Updates" ↔ "Restart to Update"
- **Gotcha**: `isAlive(win)` guard needed — fixes null mainWindow race condition at startup
- **Platform icons**: macOS uses template image (auto dark/light); Linux/Windows use explicit `trayDark.png`/`trayLight.png` based on `nativeTheme.shouldUseDarkColors`
- Theme listener: `nativeTheme.on('updated')` swaps icon on Linux/Windows (macOS excluded — template image handles it)
- Quit calls `app.quit()` after destroying window

## Database Purge
- **Purge Conversations**: deletes conversations + folders; preserves settings, auth, MCP, themes, shortcuts
- **Reset All**: deletes everything except `settings` and `auth` tables
- Both use `db.transaction()` for atomicity

## Shared Infrastructure
- `src/shared/constants.ts` — models, permissions, setting defs, exclude patterns (single source of truth)
- `src/main/utils/` — `paths.ts` (expandTilde), `mime.ts` (consolidated MIME), `validate.ts`, `json.ts` (safeJsonParse), `errors.ts` (sanitizeError)
- ARIA labels/roles across 40+ components

## Testing & ABI Swap
- `npm test` — Vitest: `vitest.config.main.ts` (node) + `vitest.config.renderer.ts` (jsdom)
- `@testing-library/react` pinned to v15 (v16 requires React 19)
- Tests colocated: `*.test.ts` next to source
- **better-sqlite3 ABI swap**: `scripts/rebuild-native.js` at postinstall builds Electron + Node binaries to `.native-cache/`
- `pretest`/`posttest` swap binaries; custom scripts must call them explicitly (npm hooks only fire for `test`)
- `npm rebuild better-sqlite3` cleans `build/` — backups MUST live outside it (hence `.native-cache/`)
- **If Ctrl+C interrupts tests**: run `npm run posttest` to restore Electron binary before `npm run dev`

## IPC Timeout
- All `ipcRenderer.invoke()` wrapped with `withTimeout()` (default 30s); `ms <= 0` disables timeout
- Streaming calls (`messages:send`, `messages:regenerate`, `messages:edit`) use `_streamingTimeoutMs` (default 300s)
- **Configurable**: `streamingTimeoutSeconds` setting (Settings > General); 0 = no timeout; synced to preload via `setStreamingTimeout()`
