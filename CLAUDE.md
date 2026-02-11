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

## Theming System (Unified CSS Vars + Tailwind)
- **Single source of truth**: CSS custom properties (`--color-*`) defined in theme `.css` files at `~/.agent-desktop/themes/`
- **Tailwind mapping**: `tailwind.config.ts` maps all colors to CSS vars — `bg-primary` → `var(--color-primary)`, `text-body` → `var(--color-text)`, etc.
- **Naming convention**: `base` (not `bg`) for `--color-bg`, `body` (not `text`) for `--color-text`, `contrast` for `--color-text-contrast` — avoids Tailwind collisions like `bg-bg` or `text-text`
- **No hardcoded styles**: zero inline hex values in renderer components; all colors via Tailwind classes or CSS utility classes
- **Compound utility classes** in `globals.css` `@layer components`: `status-block-*` (left border + tinted bg), `chip-*` (badge), `result-bg-*` (panels), `bg-primary-tint`
- **Tinting via `color-mix`**: `color-mix(in srgb, var(--color-*) N%, transparent)` — Tailwind opacity modifiers don't work with raw CSS var values
- **Exceptions**: `style={{ backgroundColor: c }}` for dynamic runtime values (theme swatches), `document.documentElement.style.fontSize` for computed font size
- **Cheatsheet**: `cheatsheet.md` auto-seeded in themes directory at launch — documents all CSS vars, Tailwind mappings, utility classes, and theme creation workflow
- **Built-in themes**: `default-dark.css`, `default-light.css` — seeded by `ensureThemeDir()` if absent; include all 13 CSS variables
- **Theme editor**: Monaco CSS editor in Settings > Appearance with create/edit/delete; validates filenames, protects builtins

## File Explorer Panel
- Right panel shows a file tree of the conversation's CWD
- **Lazy loading**: two backend functions in `src/main/services/files.ts`:
  - `files:listDir` — flat single-level listing, no recursion, no budget, no skip list (only hides `.` prefix hidden files). Used by the file explorer
  - `files:listTree` — recursive DFS scan (MAX_DEPTH=10, MAX_FILES=500, skips `.` and `node_modules`). Used only by `@mention` autocomplete in MessageInput
- All folders visible in explorer (including `venv`, `node_modules`, `__pycache__`) — children loaded on-demand when expanded
- Store: `src/renderer/stores/fileExplorerStore.ts` — tree, expandedPaths (Set), selectedFile, content, loading, error, cwd
  - `expandDir(path)`: adds to expandedPaths, fetches children via `listDir` if not cached
  - `collapseDir(path)`: removes path + descendants from expandedPaths
  - `toggleDir(path)`: expand/collapse toggle
  - `refresh()`: fetches root + all expanded dirs in parallel via `Promise.all`, rebuilds tree in depth order
- Component: `src/renderer/components/panel/FileExplorerPanel.tsx` — tree view (40%) + file viewer (flex-1)
- Viewers: Monaco editor (code), `HtmlPreview` (sandboxed iframe), `MarkdownArtifact` (react-markdown), `MermaidBlock` (`.mmd`), `SvgPreview` (DOMPurify-sanitized), **image preview** (`<img>` with data URL)
- **No file size limits**: `readFile` has no max size — reads any file. Returns optional `warning` field for files > 100MB (`LARGE_FILE_THRESHOLD`). `MAX_PASTE_SIZE = 5MB` kept only for clipboard paste (`savePastedFile`)
- **Image support**: raster images (png/jpg/jpeg/gif/webp/bmp/ico/avif/tiff) read as binary → base64 data URL with `language: 'image'`; `getImageMime()` maps extensions to MIME types
- **SVG preview**: `.svg` files rendered via `SvgPreview` component (DOMPurify-sanitized inline SVG) instead of raw code
- Skips hidden files (`.` prefix) only; sorts dirs-first, case-insensitive
- Auto-refresh: file tree reloads when streaming finishes
- No auto-open: user toggles panel manually
- DB `artifacts` table left inert (no migration needed)
- **Context menu** (right-click on file/folder): Open with Default App, Reveal in File Manager, Copy Path, Rename (inline), Duplicate, Move to Trash
- Backend operations: `files:revealInFileManager` (shell.showItemInFolder), `files:openWithDefault` (shell.openPath), `files:trash` (shell.trashItem), `files:rename` (fs.rename + anti-traversal validation), `files:duplicate` (fs.cp recursive + auto-naming)
- Inline rename: `RenameInput` component with auto-select name without extension, Enter/blur=submit, Escape=cancel, `doneRef` prevents double-submit
- **Theme apply**: when CWD is `~/.agent-desktop/themes/`, `.css` files show "Apply"/"Active" button in tree + viewer header
  - `isThemesDirectory(cwd)` detects themes folder via path suffix check
  - `ApplyThemeButton` component: reads theme via `themes:read(filename)`, calls `settingsStore.applyTheme()`
  - Active theme shows "Active" badge (primary), others show "Apply" button (accent)
  - File tree node restructured: `<div>` wrapper + `<button>` inner to avoid nested interactive elements

## CWD / Working Directory
- Each conversation has a `cwd` column (nullable, defaults to `~/.agent-desktop/sessions-folder/{id}/`)
- CWD is injected into the system prompt as a directive so the agent writes files there
- `getAISettings()` must be called BEFORE `getSystemPrompt()` (cwd needed for prompt)
- Chat header shows cwd with folder picker button

## AI Settings
- Stored in `settings` table: `ai_model`, `ai_maxTurns`, `ai_maxThinkingTokens`, `ai_maxBudgetUsd`, `ai_defaultSystemPrompt`, `ai_permissionMode`, `ai_tools`
- Settings page at "AI / Model" tab (includes Permission Mode dropdown)
- `AISettings` interface exported from `streaming.ts` — includes `tools`, `permissionMode`, `mcpServers`

## Cascading AI Settings (Global → Folder → Conversation)
- `ai_overrides TEXT` column on both `folders` and `conversations` tables (JSON, nullable)
- Format: `{"ai_model": "claude-opus-4-6", "ai_maxTurns": "10"}` — only overridden keys present
- `null` / `{}` = all settings inherited from parent level
- Cascade priority: Conversation > Folder > Global settings
- Backend: `getAISettings()` in `messages.ts` merges global → folder → conversation overrides
- `AIOverrides` interface in `src/shared/types.ts` — typed keys matching settings table
- Client utility: `src/renderer/utils/resolveAISettings.ts` — `parseOverrides()`, `resolveEffectiveSettings()`, `getInheritanceSource()`
- `AIOverridesPopover` component — reusable popover with per-setting override toggle
- ChatView: gear icon next to model name opens conversation overrides popover; model name turns primary when overridden
- FolderTree: "AI Settings" in folder right-click context menu opens folder overrides popover
- Overrideable keys: `ai_model`, `ai_maxTurns`, `ai_maxThinkingTokens`, `ai_maxBudgetUsd`, `ai_permissionMode`, `ai_tools`, `ai_defaultSystemPrompt`, `ai_mcpDisabled`
- `ai_defaultSystemPrompt` cascade: conversation `system_prompt` column > conv `ai_overrides` > folder `ai_overrides` > global setting
- NOT cascaded (per-conversation only): `cwd`, `kb_enabled`

## Folder Default CWD
- `default_cwd TEXT` column on `folders` table (nullable) — sets CWD for new conversations created inside the folder
- DB migration in `schema.ts` adds column via `ALTER TABLE`
- `folders:update` accepts `default_cwd` in allowed fields (validated as string, max 1000 chars)
- `FolderSettingsPopover` component (`src/renderer/components/settings/FolderSettingsPopover.tsx`) — combines AI overrides + default CWD in one popover
- FolderTree: "Folder Settings" context menu item (renamed from "AI Settings") opens `FolderSettingsPopover`
- When creating a conversation inside a folder (`createConversation` + `moveToFolder`), the folder's `default_cwd` is applied via `updateConversation`
- `Folder` type in `src/shared/types.ts` includes `default_cwd: string | null`

## Allowed Tools (SDK Built-in)
- Replaces the old "Custom Tools" system (dead code removed)
- `SDK_TOOLS` constant in `src/main/services/tools.ts`: 11 built-in tools (Bash, Read, Edit, Write, Glob, Grep, WebFetch, WebSearch, NotebookEdit, Task, TodoWrite)
- `ai_tools` setting: `'preset:claude_code'` (all tools) or JSON array of tool names
- IPC: `tools:listAvailable`, `tools:setEnabled`, `tools:toggle`
- Settings tab: "Allowed Tools" with per-tool toggles + Enable/Disable All

## Permission Mode
- `ai_permissionMode` setting: `'bypassPermissions'` (default), `'acceptEdits'`, `'default'`, `'dontAsk'`, `'plan'`
- `allowDangerouslySkipPermissions` only set when mode is `bypassPermissions`
- Dropdown in "AI / Model" settings tab

## MCP Servers → SDK Integration
- Existing CRUD in `src/main/services/mcp.ts` stores configs in `mcp_servers` table
- **Transport types**: `stdio` (default), `http`, `sse` — stored in `type` column on `mcp_servers`
- DB migration adds `type TEXT DEFAULT 'stdio'`, `url TEXT`, `headers TEXT DEFAULT '{}'` to `mcp_servers`
- `getAISettings()` in `messages.ts` reads enabled servers and builds transport-specific SDK configs:
  - stdio: `{ command, args, env }` — http/sse: `{ type, url, headers }`
- `streaming.ts` passes `mcpServers` to `sdk.query()` options + generates `allowedTools` wildcards (`mcp__<name>__*`)
- `allowedTools` is required by the SDK — without it, MCP tools are not usable even with `bypassPermissions`
- **MCP connection status**: `system` init messages from SDK handled in streaming loop → `mcp_status` chunks
- `McpStatusBlock.tsx`: collapsible green/red/yellow status block per server; rendered in `StreamingIndicator`
- **Name validation**: server names must not contain `__` (conflicts with SDK tool naming `mcp__name__tool`)
- **URL validation**: `http`/`https` protocol only, max 2048 chars
- **Headers validation**: plain object with string keys/values only
- `McpServerForm.tsx`: transport type radio buttons (stdio/HTTP/SSE) with conditional fields
- `McpServerList.tsx`: `[HTTP]`/`[SSE]` badges + truncated URL for non-stdio servers
- **Test Connection**: `mcp:testConnection` IPC handler spawns process (stdio) or fetches URL (http/sse), captures stdout/stderr
  - 10s timeout, 4KB output cap, command-line header (`$ command arg1 arg2`) in output for diagnosis
  - IPC timeout 15s (> backend 10s to avoid masking results)
  - Returns `McpTestResult { success, output }` — never throws, always returns displayable result
  - UI: teal "Test" button per server in `McpServerList`, expandable green/red result panel with `<pre>` output
  - Store: `mcpStore.testResults`, `testConnection()`, `clearTestResult()`
- **Args input**: dynamic list (add/remove rows, one field per arg) — replaces comma-separated text field
  - `flatMap(s => s.trim().split(/\s+/))` on save auto-splits `--flag value` into separate tokens
  - Round-trip safe: DB stores JSON array, edit reloads exact tokens, save re-tokenizes
- Settings tab: "MCP Servers" now renders `McpServerList` component directly

## Tool Use Visualization (Streaming + Persisted)
- `StreamPart` union type: `{ type: 'text' }` | `{ type: 'tool', status: 'running' | 'done', input?, output? }`
- `StreamChunk` includes `tool_start`, `tool_input`, and `tool_result` event types with `toolName`/`toolId`/`toolOutput`/`toolInput`
- `streaming.ts`: captures tool calls via stub-then-enrich pattern using `Map<string, ToolCall>`
  - `content_block_start` → creates stub ToolCall (guaranteed to fire)
  - `input_json_delta` → accumulates input JSON
  - `content_block_stop` → finalizes input on stub
  - `result` → enriches existing stub with output (or creates new entry)
- `chatStore.ts`: `streamParts: StreamPart[]` replaces flat `streamingContent` string; backward-compat getter kept
- `chatStore.ts` stream listener: handles `tool_input` chunk (sets input on running tool), enhanced `tool_result` (includes output + input)
- `ToolUseBlock.tsx`: teal-colored block with spinner (running) or collapsible Input/Output sections (done)
- `StreamingIndicator.tsx`: renders interleaved text + tool parts from `streamParts` prop
- **Persistence**: `ToolCall` type in `src/shared/types.ts`, `tool_calls TEXT` column on messages table
- `saveMessage()` accepts optional `toolCalls: ToolCall[]` — serialized to JSON in `tool_calls` column
- `streamMessage()` returns `{ content, toolCalls: ToolCall[], aborted }` — tool calls collected from Map
- `ToolCallsSection.tsx`: collapsible "N tools used" section in `MessageBubble` for persisted tool calls
- `toolCallToStreamPart()` converts persisted `ToolCall` back to `StreamPart` for reuse of `ToolUseBlock`
- CSS: `--color-tool: #00bcd4` in themes.css; `tool-pulse` keyframes in globals.css

## Knowledge Base (Filesystem-Based)
- **Source of truth**: `~/.agent-desktop/knowledges/` directory — sub-folders are "collections"
- `ensureKnowledgesDir()` in `knowledge.ts` creates the directory at startup (pattern: `ensureThemeDir()`)
- **Types**: `KnowledgeCollection` (name, path, fileCount, totalSize), `KnowledgeSelection` (folder, access: read|readwrite)
- **IPC handlers**: `kb:listCollections` (scan dirs), `kb:getCollectionFiles` (list files in collection), `kb:openKnowledgesFolder` (shell.showItemInFolder)
- **Per-conversation selection**: stored in `ai_overrides` as `ai_knowledgeFolders` key (JSON `KnowledgeSelection[]`)
- Follows the `ai_mcpDisabled` cascade pattern (global → folder → conversation overrides)
- Empty/absent `ai_knowledgeFolders` = no KB active (replaces old `kb_enabled` column)
- **System prompt injection**: `getSystemPrompt()` reads `ai_knowledgeFolders` from cascaded overrides, recursively reads supported files, injects with `--- Knowledge [{access}]: {collection}/{file} ---` markers
- `readwrite` collections add a write-access directive to the system prompt
- 500KB cumulative size guard — files beyond the limit are skipped
- **CWD hook integration**: `buildCwdRestrictionHooks(cwd, additionalWritablePaths?)` — `readwrite` collections' paths passed as additional writable paths
- `isPathOutsideAllowed(filePath, cwd, additionalPaths)` generalizes single-CWD check to multi-root
- `getAISettings()` returns `writableKnowledgePaths: string[]` from cascaded `ai_knowledgeFolders`
- **Frontend store**: `knowledgeStore.ts` — `collections: KnowledgeCollection[]`, `loadCollections()`
- **Settings UI**: `KnowledgeManager.tsx` — path display, "Open in File Manager", collection list with expandable file preview
- **ChatStatusLine**: KB dropdown with collection checkboxes + access badge (R/RW toggle) + "Open Knowledges Folder" link
- **ChatView**: `kbSelections` parsed from `effectiveSettings['ai_knowledgeFolders']`, `handleKbCollectionToggle`, `handleKbAccessToggle`
- DB tables `knowledge_files`, `conversation_knowledge` left inert (no destructive migration)

## MCP Server Status
- Status derived from `enabled` field: `'configured'` (enabled=1) or `'disabled'` (enabled=0)
- No runtime connection tracking — Agent SDK manages connections internally
- `mcp:getTools` removed — tools are discovered automatically by the SDK

## File Attachments
- Users can attach files via paperclip button or drag-and-drop onto the chat area
- Components: `FileUploadButton`, `FileDropZone`, `AttachmentPreview` (in `src/renderer/components/attachments/`)
- `chatStore.sendMessage()` accepts optional `attachments: Attachment[]` parameter
- Forwarded to `window.agent.messages.send(conversationId, content, attachments)`
- **Copy-to-session**: `copyAttachmentsToSession()` in `messages.ts` copies files to `{cwd}/attachments/` with dedup naming (`uniqueDestPath`)
- Markdown links (`[filename](path)`) appended to message content so the agent sees file paths
- **File path API**: `webUtils.getPathForFile(file)` via `window.agent.system.getPathForFile()` replaces unsafe `(file as any).path`
- User messages rendered with `MarkdownRenderer` (attachment links are clickable)
- **Paste-to-attach**: Ctrl+V images/files from clipboard into chat input → saved to temp dir via `files:savePastedFile` IPC
  - Backend: `mimeToExt()` maps MIME → extension; writes to `os.tmpdir()/agent-paste/` with unique filename
  - 5MB limit (`MAX_IMAGE_SIZE`), validates `Uint8Array` + `string` mimeType
  - ChatView `handlePaste` callback: reads clipboard items, calls `savePastedFile`, appends to `attachments` state
  - `MessageInput` accepts `onPaste` prop, forwarded to `<textarea onPaste={...}>`

## General Settings (Wired)
- `sendOnEnter`: when `'false'`, Enter inserts newline and Ctrl+Enter sends; default `'true'` = Enter sends
- `autoScroll`: when `'false'`, disables auto-scroll to bottom on new messages
- `minimizeToTray`: when `'true'`, closing the window hides to tray instead of quitting
- `notificationSounds`: when `'true'`, plays Web Audio tones on stream completion/error

## Chat Status Line
- `src/renderer/components/chat/ChatStatusLine.tsx` — interactive component below chat input
- Displays: effective model (dropdown) · permission mode label · MCP servers (dropdown)
- **Model dropdown**: click model name → select Sonnet 4.5 / Opus 4.6 / Haiku 4.5; writes `ai_model` to conversation `ai_overrides`
- **MCP server dropdown**: click "N/M MCP" → checkbox list of enabled MCP servers; toggle individual servers per conversation
- Per-conversation MCP: `ai_mcpDisabled` key in `ai_overrides` — JSON array of disabled server names (negative list)
- Backend: `filterMcpServers()` in `messages.ts` removes disabled servers before passing to SDK
- Default (absent key) = all enabled servers active; new servers auto-active unless explicitly disabled
- `McpServerEntry` type exported: `{ name: string; active: boolean }`
- Model simplification: `.replace('claude-', '').replace(/-\d{8}$/, '')` — same as header
- Permission labels: `PERMISSION_LABELS` map (Bypass, Accept Edits, Default, Don't Ask, Plan Only)
- MCP servers loaded at ChatView mount via `useMcpStore.loadServers()` (previously only loaded in Settings page)
- Replaces the old keyboard hint (`Enter to send...`) that was in `MessageInput.tsx`

## Dynamic Keyboard Shortcuts
- Shortcuts stored in `keyboard_shortcuts` table, loaded by `useShortcutsStore`
- `App.tsx` uses dynamic listener: parses accelerators from store, matches against `KeyboardEvent`
- Utility: `src/renderer/utils/shortcutMatcher.ts` (`parseAccelerator`, `matchesEvent`)
- ShortcutSettings has "Reset All to Defaults" button
- Actions: `new_conversation`, `toggle_sidebar`, `toggle_panel`, `settings`, `focus_search`, `stop_generation`, `send_message`

## Deep Links & Tray Events
- Deep link protocol: `agent://conversation/{id}` — navigates to conversation and shows window
- Tray "New Conversation" menu item sends `tray:newConversation` IPC event
- Both events wired in `App.tsx` init useEffect via `window.agent.events.*`

## Auto-Title Generation
- `generateConversationTitle()` in `messages.ts` — fires after first assistant response (fire-and-forget)
- Uses Haiku (`claude-haiku-4-5-20251001`) via Agent SDK `query()` with plain text prompt (no `outputFormat`)
- Extracts title from `assistant` message `message.content[].text` (primary) or `result` string on `success` (fallback)
- Works even when SDK returns `error_max_turns` — assistant messages are yielded before the error
- `tools: []` disables tool use; `maxTurns: 1`
- Strips surrounding quotes (`"` / `'`), trims whitespace, truncates to 80 chars
- Title saved to DB + pushed to renderer via `conversations:titleUpdated` IPC event
- Renderer listener in `conversationsStore.ts` updates Zustand state on receive
- **Note**: `outputFormat: json_schema` was removed — it causes SDK to use internal tool_use cycle that exhausts `maxTurns: 1`

## IPC Timeout
- All `ipcRenderer.invoke()` calls wrapped with `withTimeout()` (default 30s)
- Streaming calls (`messages:send`, `messages:regenerate`, `messages:edit`) get 300s timeout

## Sidebar (Unified Tree)
- `SidebarTree` in `FolderTree.tsx` — single component for folders + conversations (replaced separate `ConversationList`)
- Drag-and-drop: conversations are draggable onto folders or "Unfiled" zone via HTML5 DnD API
- `ConversationItem` accepts `depth` prop for indentation within folders
- CSS classes: `.sidebar-dragging` (opacity 0.4), `.sidebar-drop-active` (outline + deep bg)
- Folders auto-expand when a conversation is dropped in; search mode auto-expands all
- **Folder delete confirmation**: modal dialog with options — "Delete folder + conversations" (recursive purge) or "Keep conversations" (reparent to root)
- `folders:delete` accepts optional `mode` param: `'delete'` = recursive BFS purge of descendants + conversations, default = reparent to root
- `conversationsStore.deleteFolder(id, mode?)` handles optimistic UI with full rollback on error; clears `activeConversationId` if deleted

## Chat Layout
- `FileDropZone` wrapper must have `flex-1 flex flex-col overflow-hidden` to propagate flex sizing
- `ChatView` layout order: Header → MessageList (flex-1) → Attachments → Input (flex-shrink-0)
- `MessageList` uses `overflow-y-auto` inner div with `h-full` for scrolling

## Code Blocks
- `CodeBlock.tsx`: foldable — auto-collapsed when >10 lines, expanded when <=10
- `defaultCollapsed` prop overrides auto-detection
- Header shows chevron toggle + language label + line count (when collapsed)
- Copy button always visible regardless of fold state

## Markdown Rendering
- `MarkdownRenderer.tsx` uses `react-markdown` + `remark-gfm` (NO `rehype-highlight`)
- `extractText()` helper recursively extracts raw text from React element trees
- Required because ReactMarkdown children can be element arrays, not raw strings
- Without `extractText`, code blocks render `[object Object]` instead of content

## Conversation History (Streaming)
- `buildPromptWithHistory()` exported from `streaming.ts` — builds prompt with XML-tagged history
- Single message: returns bare content (no wrapping)
- Multi-turn: prior messages wrapped in `<conversation_history>` with `<msg role="...">` tags
- Current (last) message placed outside the history block

## Stream Isolation & Per-Conversation Buffers
- `StreamChunk` includes optional `conversationId` field — tags every chunk to its originating conversation
- `streamMessage()` accepts `conversationId` as 4th param; all `sendChunk()` calls include it via `convExtra` spread
- `messages.ts` handlers (`send`, `regenerate`, `edit`) pass `conversationId` to `streamMessage()`
- **Multi-stream**: `streamBuffers: Record<number, StreamPart[]>` — dict indexed by conversationId; N conversations can stream simultaneously
- **Source of truth**: a conversation is "streaming" iff its ID is a key in `streamBuffers` (no separate `streamingConversationId` scalar)
- **View/buffer separation**: `streamParts`/`streamingContent` are views synced from `streamBuffers[activeConversationId]`
- `syncViewFromBuffer()` helper projects buffer → view on conversation switch
- `setActiveConversation` derives `isStreaming` from buffer existence; clears `messages: []` when switching to prevent stale data
- Stream listener writes to `streamBuffers[bufferKey]` always; syncs view only if `bufferKey === activeConversationId`
- Guard: drops chunks where `bufferKey` has no entry in `streamBuffers` (not a streaming conversation)
- `done`/`error` chunks delete the buffer entry; `sendMessage`/`regenerate`/`edit` cleanup in try/catch too
- `MessageList` guard: `isLoading && !isStreaming` prevents loading skeleton from hiding StreamingIndicator
- Backward compat: chunks without `conversationId` fall back to `activeConversationId`
- `setup.ts` exports `capturedStreamListener` for testing the stream listener directly

## Database Purge (Storage Settings)
- Settings > Storage > "Danger Zone" section with two-step confirmation buttons
- **Purge Conversations**: `system:purgeConversations` — deletes conversations (cascade → messages, artifacts, conversation_knowledge) + folders; preserves settings, auth, KB files, MCP servers, themes, shortcuts
- **Reset All Data**: `system:purgeAll` — deletes everything except `settings` and `auth` tables (conversations, folders, knowledge_files, mcp_servers, themes, keyboard_shortcuts)
- Both use `db.transaction()` for atomicity; return counts for UI feedback
- IPC: `system:purgeConversations`, `system:purgeAll` in `src/main/services/system.ts`
- UI: `StorageSettings.tsx` — `ConfirmTarget` state machine (null → 'conversations'|'all' → confirm → null)

## Tool Approval & AskUserQuestion (Agent SDK canUseTool)
- `canUseTool` callback is **always set** on SDK query options, regardless of permission mode
- **AskUserQuestion** is always intercepted interactively: sends `ask_user` chunk → renderer shows `AskUserBlock` → user answers → SDK gets `updatedInput`
- In **bypass mode**: `allowDangerouslySkipPermissions = true` alongside `canUseTool`; non-AskUserQuestion tools auto-approved (`{ behavior: 'allow', updatedInput: input }`)
- In **non-bypass modes**: tool approval flow sends `tool_approval` chunk, awaits user Allow/Deny
- `askUserToolIds: Set<string>` in streaming loop suppresses AskUserQuestion from tool pipeline (no `tool_start`/`tool_input`/`tool_result` chunks, no `toolCallsMap` entry)
- Callback creates a Deferred Promise in `pendingRequests: Map<string, { resolve }>`, sends chunk to renderer, awaits response
- `respondToApproval(requestId, response)` exported from `streaming.ts` — resolves the pending Promise
- IPC handler `messages:respondToApproval` in `messages.ts` bridges renderer → main process
- Preload: `window.agent.messages.respondToApproval(requestId, response)` exposed
- `StreamChunk` types: `'tool_approval'` (with `requestId`, `toolName`, `toolInput` JSON string) and `'ask_user'` (with `requestId`, `questions` JSON string)
- `StreamPart` union extended: `tool_approval` part (requestId, toolName, toolInput object) and `ask_user` part (requestId, questions array)
- `chatStore.ts` stream listener: parses JSON from chunk fields, pushes typed StreamPart entries
- `ToolApprovalBlock.tsx`: yellow-bordered block, shows tool name + input fields, Allow/Deny buttons, status badge after response
- `AskUserBlock.tsx`: primary-colored block, renders questions with radio/checkbox options + "Other" text input, read-only summary after submit
- `StreamingIndicator.tsx`: renders `ToolApprovalBlock` and `AskUserBlock` alongside existing parts
- `ToolCallsSection.tsx`: defensive `AskUserFallback` component renders persisted AskUserQuestion tool calls as read-only Q&A (safety net)
- Edge cases: `abortStream()` and `finally` block both call `denyAllPending()` to resolve all pending with deny
- Types: `AskUserQuestion`, `AskUserOption`, `ToolApprovalResponse`, `AskUserResponse` in `src/shared/types.ts`

## CWD Restriction Hooks (Agent SDK PreToolUse)
- `src/main/services/cwdHooks.ts` — PreToolUse hook that denies write operations outside conversation CWD
- Exports: `isPathOutsideCwd()`, `extractBashWritePaths()`, `buildCwdRestrictionHooks()`
- Uses SDK hooks API: `hooks: { PreToolUse: [{ matcher: 'Write|Edit|NotebookEdit|Bash', hooks: [callback] }] }`
- Callback signature: `async (input, toolUseID, { signal })` — `input.tool_name`, `input.tool_input`, `input.hook_event_name`
- Returns `{ hookSpecificOutput: { hookEventName, permissionDecision: 'deny', permissionDecisionReason } }` for violations
- **Must use `'deny'` not `'ask'`**: bypass mode auto-approves `'ask'` decisions, making them useless
- Tilde expansion: `~/path` expanded to `$HOME/path` via `os.homedir()` before path resolution
- Bash: best-effort regex extraction of write targets (redirections `>`, `>>`, commands `tee`, `cp`, `mv`, `mkdir`, `touch`, `ln`, `rsync`)
- Setting: `hooks_cwdRestriction` (default: `'true'`) — toggleable in Settings > AI with confirmation dialog on disable
- `AISettings.cwdRestrictionEnabled` cascades via global → folder → conversation overrides
- `streaming.ts`: `queryOptions.hooks = buildCwdRestrictionHooks(cwd)` — runs independently of permission mode
- 41 tests in `cwdHooks.test.ts`

## Security Hardening
- **SVG sanitization**: DOMPurify in `SvgPreview.tsx` — `USE_PROFILES: { svg: true }`, forbids `script`, `foreignObject`, `use` tags
- **HTML sandbox**: `sandbox=""` (maximum restriction) in `HtmlPreview.tsx`
- **URL whitelist**: `system:openExternal` only allows `http:` / `https:` protocols
- **Path traversal**: `validatePathSafe()` in `src/main/utils/validate.ts` blocks `/proc`, `/sys`, `/dev`, `/boot`, `/sbin`, `/etc`
- **MCP command injection**: `DANGEROUS_CHARS` regex in `mcp.ts` validates command field against shell metacharacters
- **IPC validation**: `validateString`, `validatePositiveInt`, `validatePathSafe` applied to all IPC handler entry points
- **Async I/O**: All `readFileSync`/`statSync` on main thread converted to `fs.promises.*` (messages.ts, knowledge.ts, attachments.ts)
- **Per-conversation abort**: `Map<number, AbortController>` in `streaming.ts` replaces single global scalar
- **DB indexes**: `idx_messages_created_at(conversation_id, created_at)`, `idx_folders_parent(parent_id)` in schema.ts
- **CWD cache limit**: `CWD_CACHE_MAX = 1000` with FIFO eviction in messages.ts

## HTML JS Permission Banner (File Explorer)
- HTML files in the file explorer show a JS permission banner instead of auto-enabling scripts
- `JsPermissionBanner` component in `FileExplorerPanel.tsx` — 4 options: Allow once, Trust folder, Trust all, Continue without JS
- `fileExplorerStore` state: `jsTrustedFolders: string[]`, `jsTrustAll: boolean`
- Persisted via settings: `html_jsTrustedFolders` (JSON array), `html_jsTrustAll` (`'true'`/absent)
- `isJsTrusted(filePath)` checks `jsTrustAll` first, then folder prefix match
- `loadJsTrust()` called on mount; auto-enables JS for trusted files on selection change
- `HtmlPreview` has `key` prop (`${previewUrl}-${sandbox}`) to force iframe remount when sandbox changes

## Shared Constants & DRY Infrastructure
- `src/shared/constants.ts` — single source of truth for model/permission/setting definitions shared across main + renderer:
  - `DEFAULT_MODEL`, `HAIKU_MODEL` — model ID constants (replace 9+ hardcoded strings)
  - `MODEL_OPTIONS`, `PERMISSION_OPTIONS` — dropdown option arrays (`as const`)
  - `PERMISSION_LABELS` — derived `Record<string, string>` for display
  - `SETTING_DEFS: SettingDef[]` — AI override form field definitions (type, label, options)
  - `AI_OVERRIDE_KEYS` — typed key list for override iteration
  - `McpServerName` interface — `{ name: string }`
  - `shortenModelName()` — strips `claude-` prefix and date suffix
- `src/main/utils/paths.ts` — `expandTilde(p)` unified from files.ts + cwdHooks.ts (uses `os.homedir()`)
- `src/main/utils/mime.ts` — consolidated MIME utilities from files.ts + attachments.ts + knowledge.ts:
  - `IMAGE_EXTS`, `IMAGE_EXTENSIONS_DOTTED`, `TEXT_EXTENSIONS` — file extension sets
  - `getImageMime()`, `mimeToExt()`, `getMimeType()` — MIME mapping functions
- `src/main/utils/db.ts` — `getSetting(db, key)` extracted from whisper.ts
- `src/renderer/hooks/useClickOutside.ts` — shared React hook replacing 3 inline implementations
- `src/renderer/utils/mcpUtils.ts` — `parseMcpDisabledList(raw)` replacing 4 try/JSON.parse instances
- `src/renderer/components/settings/OverrideFormFields.tsx` — shared AI override form used by AIOverridesPopover + FolderSettingsPopover
- `src/renderer/components/icons/{CheckIcon,ChevronDownIcon}.tsx` — extracted SVG icons
- `src/renderer/components/ui/Checkbox.tsx` — shared checkbox component

## Utility Helpers
- `src/main/utils/validate.ts` — `validateString()`, `validatePositiveInt()`, `validatePathSafe()` for IPC input validation
- `src/main/utils/json.ts` — `safeJsonParse<T>(json, fallback)` replaces try/catch JSON.parse patterns across services
- `src/main/utils/errors.ts` — `sanitizeError(err)` strips internal file paths from outbound error messages

## AppImage Environment & Auth Diagnostics
- **`src/main/utils/env.ts`** — called once at startup (before `app.whenReady()`)
  - `enrichEnvironment()`: sets `HOME`, `CLAUDE_CONFIG_DIR`, appends `~/.local/bin` etc. to PATH; sanitizes `LD_LIBRARY_PATH`/`LD_PRELOAD` for AppImage
  - `sanitizeAppImageEnv()`: removes `/tmp/.mount_*` and `APPDIR`-prefixed paths from `LD_LIBRARY_PATH` so child processes (claude CLI, whisper) don't load Electron's bundled `.so` files
  - `findBinaryInPath(name)`: pure Node.js binary search (no `spawn which`) — iterates PATH with `fs.accessSync` + `X_OK`
  - `isAppImage()`: returns `!!process.env.APPIMAGE`
- **Auth diagnostics**: `AuthDiagnostics` type in `src/shared/types.ts` — `claudeBinaryFound`, `claudeBinaryPath`, `credentialsFileExists`, `configDir`, `isAppImage`, `home`, `ldLibraryPath`, `sdkError`
- `AuthStatus` extended with `error?: string` and `diagnostics?: AuthDiagnostics`
- `auth.ts` pre-checks `~/.claude/.credentials.json` existence before calling SDK (fast fail)
- `auth.ts` catch block captures SDK error message + runs `runDiagnostics()`
- `authStore.ts` stores `diagnostics`, fetches them on login failure
- `WelcomeScreen.tsx` shows collapsible `DiagnosticsPanel` under error message
- **AppImage root cause**: SDK resolves `cli.js` via `import.meta.url` → inside `app.asar` → system `node` can't read asar → exit code 1. Fix: `asar: false`
- 18 tests in `env.test.ts`, 12 tests in `auth.test.ts`

## Tray (Refactored)
- `createTray(getWindow, ensureWindow)` — accepts closures instead of direct `BrowserWindow` reference
- `isAlive(win)` guard checks `!== null && !isDestroyed()` before any operation
- `showWindow()` helper: if window is null/destroyed, calls `ensureWindow()` first
- Tray Quit calls `app.quit()` after destroying window
- Fixes null mainWindow race condition at startup

## Accessibility (ARIA)
- ARIA labels, roles, and states added across 40+ renderer components
- Key attributes: `aria-label`, `aria-expanded`, `aria-selected`, `aria-live="polite"`, `role="tree"/"tab"/"alert"/"status"`

## Voice Input (Whisper CPP)
- Local speech-to-text via whisper.cpp binary — user installs it, Agent invokes it
- Backend: `src/main/services/whisper.ts` — `whisper:transcribe` (spawn binary, 30s timeout), `whisper:validateConfig`
- `buildAdvancedArgs(db)` reads `whisper_advancedParams` JSON setting, emits CLI flags only for non-default values
- WAV encoder: `src/renderer/utils/wavEncoder.ts` — pure function, MediaRecorder webm → AudioContext → 16kHz mono PCM WAV
- Store: `src/renderer/stores/voiceInputStore.ts` — `isRecording`, `isTranscribing`, `error`, `lastTranscription`
- Component: `src/renderer/components/chat/VoiceInputButton.tsx` — mic icon next to FileUploadButton
- Settings: `src/renderer/components/settings/VoiceInputSettings.tsx` — binary path, model path, browse, test config, advanced params
- Settings keys: `whisper_binaryPath` (default: 'whisper-cli'), `whisper_modelPath` (default: ''), `whisper_advancedParams` (JSON), `whisper_autoSend` (default: 'false')
- **Advanced Parameters**: collapsible section in Settings > Voice Input with 14 whisper-cli options grouped by category:
  - General: language (`-l`), translate (`-tr`), initial prompt (`--prompt`)
  - Performance: threads (`-t`), no GPU (`-ng`), flash attention (`-fa`/`-nfa`)
  - Decoding: temperature (`-tp`), best of (`-bo`), beam size (`-bs`), no speech threshold (`-nth`), no fallback (`-nf`)
  - VAD: enable (`--vad`), VAD model (`-vm`), VAD threshold (`-vt`)
  - Sparse JSON persistence: only non-default values stored, empty JSON = all defaults
- **Auto-send**: `whisper_autoSend` setting — when enabled, transcribed text is sent as a message immediately instead of being pasted into the input field. ChatView watches `lastTranscription` and calls `sendMessage()` directly when auto-send is on; `externalText` prop is set to `undefined` to prevent double injection
- Keyboard shortcut: `voice_input` → `CommandOrControl+Shift+V`
- Text injection: `MessageInput` accepts `externalText` prop, appends text with smart separator
- IPC timeout: 45s on transcribe (> 30s backend timeout)
- `seedShortcuts` converted from count-gate to `INSERT OR IGNORE` (existing users get new shortcuts)

## Testing
- `npm test` — run all 802 tests (556 main + 246 renderer)
- `npm run test:main` / `npm run test:renderer` — run suites independently
- `npm run test:watch` — watch mode for main process tests
- Vitest configs: `vitest.config.main.ts` (node env) + `vitest.config.renderer.ts` (jsdom env)
- Test helpers: `src/main/__tests__/db-helper.ts` (in-memory SQLite), `src/main/__tests__/ipc-helper.ts`
- Renderer test setup: `src/renderer/__tests__/setup.ts` (mocks `window.agent` globally)
- Tests colocated with source: `*.test.ts` / `*.test.tsx` next to implementation files
- `@testing-library/react` pinned to v15 (v16 requires React 19; project uses React 18)

## better-sqlite3 ABI Swap
- `scripts/rebuild-native.js` runs at `postinstall`: builds Electron + Node.js binaries, stores in `scripts/.native-cache/`
- `pretest` swaps in the Node.js binary; `posttest` restores the Electron binary (both via `cp`, <1ms)
- Custom scripts (`test:main`, `test:watch`, etc.) explicitly call `npm run pretest`/`posttest` (npm lifecycle hooks only fire for `test`)
- `npm rebuild better-sqlite3` cleans `build/` — backups MUST live outside it (hence `.native-cache/`)
- If Ctrl+C interrupts tests, run `npm run posttest` to restore the Electron binary before `npm run dev`
