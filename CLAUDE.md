# Agent Desktop — Project Instructions

## Build & Run
- `npm run dev` — start dev server with hot reload
- `npm run build` — compile TypeScript (output: `out/`)
- `npm run dist:linux` — package AppImage + deb (output: `release/`)
- `npm run dist:win` — package NSIS installer + portable exe (output: `release/`, requires Wine on Linux)
- `npm run publish:linux` — build + publish Linux to GitHub Releases with `--publish always` (requires `GH_TOKEN`)
- `npm run publish:win` — build + publish Windows to GitHub Releases with `--publish always` (requires `GH_TOKEN` + Wine on Linux)
- `npm test` — Vitest (main: node, renderer: jsdom); `@testing-library/react` pinned to v15 (v16 requires React 19)

## Architecture Decisions
- Electron + React + Zustand + Tailwind + sql.js (WASM SQLite)
- **electron-vite** outputs to `out/`, not `dist-electron/`
- **asar: false** — SDK `import.meta.url` resolves inside `app.asar`; system `node` can't read asar archives
- **sql.js (WASM)** — no native ABI swap needed; same binary in tests and prod
- **Fonts bundled** — box-drawing chars in ASCII diagrams need guaranteed monospace
- **No minWidth/minHeight** — Wayland compositors force windows smaller than declared minimums; Electron overflows at `minWidth` pixels
- **Per-conversation AbortController** (`Map<number, ...>`) — concurrent streams require per-conversation abort
- **MCP disable is negative list** — new servers auto-active unless explicitly disabled
- **Hybrid shortcuts** — X11: Electron `globalShortcut`, Wayland: XDG Desktop Portal
- **Hyprland uses FIFO not D-Bus** — `dbus-next` signal delivery broken in Electron's event loop
- **Session detection** — `XDG_SESSION_TYPE` > `WAYLAND_DISPLAY` > `DISPLAY` (both can be set under XWayland)
- **SDK session resume** — `sdk_session_id` on conversations; normal messages use `resume`, regenerate/edit/compact/clear reset to full history fallback; one-shot queries use `persistSession: false`

## Conventions & Cascade
- **CSS**: `@import` before `@tailwind` directives
- **Auth**: OAuth from `claude login`, NOT api_key
- **Themes**: CSS custom properties only — no hardcoded hex in renderer
- **Theme naming**: `base`/`body`/`contrast` (not `bg`/`text`/`text-contrast`) — avoids Tailwind collisions like `bg-bg`
- **Tinting**: `color-mix(in srgb, ...)` — Tailwind opacity modifiers don't work with raw CSS var values
- **Settings cascade**: Conversation > Folder > Global; `null`/`{}` = inherited
- **NOT cascaded** (per-conversation only): `cwd`, `kb_enabled`, `cleared_at`
- **NOT cascaded** (global only): `tts_summaryModel` — model selection for TTS summary generation; UI provides Haiku/Sonnet/Opus presets + Custom free text; backend defaults to Haiku if unset
- **Folder color**: nullable TEXT `#rrggbb` validated server-side; `null` = no tint; applied via `color-mix` like theme tinting
- **Default folder**: `is_default = 1` on `folders`; auto-created at startup as "Unsorted" with `position = -1`; non-deletable, renamable; all new/imported conversations assigned to it; no `folder_id = NULL` in system
- **Heatmap**: `heatmap_enabled`, `heatmap_mode` (`'relative'`|`'fixed'`), `heatmap_min`, `heatmap_max` stored as strings; color via `hsvToHex(120 * (1-t), 70, 80)` applied same way; manual color takes precedence
- **Bulk IPC ops**: `deleteMany`/`moveMany` wrap per-row statements in `db.transaction()` — no `WHERE id IN (...)` (sql.js parameter binding limitation)
- **Multi-select `visibleOrder`**: store receives flat ID array from component — store cannot compute it (doesn't know folder expansion state)
- **`/compact`**: uses Haiku to summarize conversation; summary stored in `compact_summary` column on conversations table
- **`/clear`**: just sets `cleared_at` with no AI call
- **`allowedTools` wildcards** (`mcp__<name>__*`) REQUIRED — MCP tools unusable without them, even with bypass
- **`bypassPermissions`** is the only mode that sets `allowDangerouslySkipPermissions`
- **Tests**: `createTestDb()` is async — all `beforeEach` must `await`; tests colocated as `*.test.ts`; coverage thresholds enforced (70% lines, 60% branches) via v8 provider
- **Tailwind variant**: prefer `compact:` over `mobile:` for new code
- **Async I/O only**: all main-thread file I/O uses `fs.promises.*` — no sync methods
- **ContextMenu**: shared `ContextMenu`/`ContextMenuItem`/`ContextMenuDivider` in `src/renderer/components/shared/` — all context menus use this; draggable by default

## Ordering Constraints
1. `enrichEnvironment()` before `app.whenReady()` — sanitizes AppImage env
2. `getAISettings()` BEFORE `getSystemPrompt()` — CWD needed for prompt injection
3. `initDatabase()` is async — must `await` in `app.whenReady()`
4. `ensureThemeDir()` seeds built-in themes at startup
5. `unbind` before `bind` in hyprctl — bindings accumulate; stale ones survive compositor restarts
6. TTS `stop()` before starting new streams
7. Server shutdown: WS clients → `wss.close()` → `httpServer.close()` (chained, not parallel)

## Window & Layout Gotchas
- **No-minWidth fix**: root element `w-full overflow-hidden` + html/body `height: 100%`/`overflow: hidden`
- **Overlay height**: `h-screen` not `h-full` — html/body/#root lack `height: 100%`, so `h-full` → auto → broken scroll
- **`ready-to-show`**: never fires for transparent BrowserWindows on Linux/Wayland — use `did-finish-load`
- **`hideOverlay()`**: must `destroy()` not `hide()` — `hide()` creates zombie windows blocking shortcut reactivation
- **Mobile mode**: binary flag (`__AGENT_WEB_MODE__`), not screen size — desktop browser via web server intentionally gets mobile layout

## CSS & Rendering Gotchas
- **Block vs inline code**: detection MUST happen in `pre` handler, not `code` — fences without language have no `className` on `code`
- **Mermaid v11 + DOMPurify**: must `ADD_TAGS: ['foreignobject', 'use']` with `html: true` — Mermaid uses `foreignObject` for text, `use`/`xlink:href` for arrows
- **SVG vs Mermaid sanitization**: SVGs FORBID `foreignObject`/`use`; Mermaid REQUIRES them — different DOMPurify configs
- **Anchor links**: `decodeURIComponent` before slugifying — browsers URL-encode accented chars in href
- **Slugify charset**: Unicode `\p{L}\p{N}` not `\w` — preserves accented characters
- **HSV color picker**: custom canvas-style (not `input[type=color]`) — native picker is OS-dependent and unstyled; HSV math is inline in FolderTree
- **Draggable floating panels**: `mousedown`→document `mousemove`/`mouseup` (not HTML drag API) — drag API fires `dragend` on leave, breaking repositioning

## Jupyter & Notebook Gotchas
- **ipykernel required**: `jupyter_client` alone gives `NoSuchKernel python3` — ipykernel registers the kernel spec
- **useEffect deps**: `[filePath]` only — including `kernelStatus` causes shutdown on every status change; use `useRef` instead
- **Dirty tracking infinite loop**: needs `lastSerializedRef` + `lastContentRef` double guard — content prop changes after save must compare against own last write

## AI, MCP & Streaming Gotchas
- **Scheduler MCP**: removed from `aiSettings.mcpServers` during unattended execution — prevents recursive task creation
- **MCP names**: must not contain `__` — conflicts with SDK tool naming `mcp__name__tool`
- **CWD hooks**: return `'deny'` not `'ask'` — bypass mode auto-approves `'ask'` decisions
- **Auto-title**: no `outputFormat: json_schema` — causes SDK internal tool_use cycle exhausting `maxTurns: 1`
- **Stream isolation**: `streamBuffers` dict keyed by conversationId — a conversation is streaming iff its ID is a key (no separate flag)
- **SDK session retry**: if `resume` fails (corrupted/deleted session), `streamAndSave` catches, clears `sdk_session_id`, and retries with full history — transparent to user
- **SDK session invalidation**: regenerate, edit, compact, clear all set `sdk_session_id = NULL` — SDK's internal history no longer matches SQLite
- **Compact summary injection**: `buildMessageHistory` prepends `compact_summary` as `[Previous conversation summary]` with role `assistant`
- **Hook system messages**: `hook_response` output is JSON-parsed for `systemMessage` field — sent as `system_message` stream chunk with `hookName`/`hookEvent` metadata; non-JSON output silently ignored
- **UserPromptSubmit hooks**: SDK does not yield `hook_response` for this event — executed app-side via `hookRunner.ts`; system messages saved as `<hook-system-message>content</hook-system-message>` tags prepended to assistant content; extracted and rendered with accent-styled boxes + `MarkdownRenderer` (not plain text)

## Quick Chat & TTS Gotchas
- **Shortcut re-toggle**: voice sends stop-recording, text hides; only creates new window if hidden/destroyed
- **Overlay stop-recording listener**: overlay must also listen (not just voice component) — voice unmounts its listener after transcription; without fallback overlay gets stuck
- **TTS `speak()`**: call `stopInternal()` not `stop()` — `stop()` clears `currentMessageId` and sends spurious `speaking:false` before new playback starts
- **Volume restore**: called from multiple paths — idempotent via `savedVolume === null` guard
- **TTS summary model**: `tts_summaryModel` is global-only (TTSSettings.tsx); backend uses `aiSettings.ttsSummaryModel || HAIKU_MODEL` fallback if unset

## Wayland & D-Bus Gotchas
- **`bus.name`**: null until D-Bus Hello handshake — must `await bus.once('connect')` first
- **`getProxyObject()`**: fails on portal Request paths — Hyprland doesn't expose for introspection
- **`preferred_trigger`**: do NOT include in `BindShortcuts` — Hyprland warns on unknown data types
- **FIFO flags**: `O_RDWR` only, no `O_NONBLOCK` — `O_NONBLOCK` causes `EAGAIN`; `O_RDWR` prevents blocking and EOF
- **FIFO double-fire**: Hyprland `echo > pipe` delivers two lines per keypress — debounce per shortcut-id (150ms)
- **Re-registration**: keeps FIFO alive, only updates hyprctl binds — no teardown/rebuild needed

## Packaging & Updates Gotchas
- **AppImage LD_LIBRARY_PATH**: strip `/tmp/.mount_*` paths — child processes load Electron's bundled `.so` otherwise
- **`artifactName`**: required in `electron-builder.yml` linux — `productName` spaces cause filename mismatch between builder/updater/GitHub
- **Publishing**: `--publish always` required — generates `latest-linux.yml`; manual AppImage uploads lack update metadata
- **deb detection**: `!process.env.APPIMAGE` → redirect to GitHub releases (deb can't auto-update)

## Web Server & Mobile Gotchas
- **Binary args**: Uint8Array serialized as `{ __type: 'binary', data }` (base64) in shim — decoded server-side
- **TTS plays on PC**: not remote device — expected behavior, not a bug
- **`useMobileMode`**: flag-based (`__AGENT_WEB_MODE__`), not viewport — intentional for all remote access

## Security Rules
- **CWD hooks**: `'deny'` not `'ask'` — bypass auto-approves `'ask'`
- **SVG sanitization**: forbid `script`, `foreignObject`, `use` — BUT Mermaid needs `foreignObject`/`use` (separate config)
- **`openExternal`**: only `http:`/`https:` protocols allowed
- **Main-thread I/O**: `fs.promises.*` only — no `readFileSync`/`statSync`
