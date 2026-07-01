# Agent Desktop — Project Instructions

## Build & Run
- `npm run dev` — start dev server with hot reload
- `npm run build` — compile TypeScript (output: `out/`)
- `npm run dist:linux` — package AppImage + deb (output: `release/`)
- `npm run dist:win` — package NSIS installer + portable exe (output: `release/`, requires Wine on Linux)
- `npm run publish:linux` — build + publish Linux to GitHub Releases with `--publish always` (requires `GH_TOKEN`)
- `npm run publish:win` — build + publish Windows to GitHub Releases with `--publish always` (requires `GH_TOKEN` + Wine on Linux)
- `npm test` — Vitest (main: node, renderer: jsdom); `@testing-library/react` pinned to v15 (v16 requires React 19)
- `npm run build:headless` — bundle headless entry point (output: `out/headless/index.js`)
- `npm run start:server` — headless web server on default port
- `npm run start:discord` — headless Discord bot
- `npm run start:headless` — headless web server + Discord bot
- `npm run audit:dedup` — list function/SQL clone clusters (TS AST)
- `npm run audit:check` — fail if dedup metrics regressed vs `scripts/.dedup-baseline.json`
- `npm run audit:baseline` — refresh the baseline after intentional improvement

## Architecture Decisions
- **`core/` vs `main/services/` boundary** — `core/` holds shared logic that runs in BOTH Electron and headless (CLI/web/Discord); `core/` MUST NOT import `'electron'`. `main/services/` holds Electron-only wiring: `ipcMain.handle` registrations, `BrowserWindow`, native `Notification`, `app.getPath`, `dialog`, `shell`. When in doubt, ask "would the headless runtime need this?" — if yes → `core/`. Cross-boundary callbacks (e.g. `MessagesHandlerOptions.broadcaster`, `setSpeakingStateListener`) are the seam: core exposes a hook, main fills it. Don't reimplement in main what core already exports.
- Electron + React + Zustand + Tailwind + sql.js (WASM SQLite)
- **Dual SDK backend** — `ai_sdkBackend` selects Claude Agent SDK (default, `'claude-agent-sdk'`) or Oh My Pi (`'pi'`); 4-line branch in `streamMessage()` delegates to the injected `_streamMessagePI` (= `streamMessageOmp`); no abstraction layer (only 2 backends). The `'pi'` backend is **out-of-process**: Oh My Pi (`@oh-my-pi/pi-coding-agent`) is a Bun-only runtime and can't be imported in Electron/Node, so `streamMessageOmp` (`src/core/services/streamingOmp.ts`) spawns the standalone `omp` binary in `--mode rpc` (JSONL over stdio) and drives it via `OmpRpcClient` (`src/core/services/pi/ompRpcClient.ts`). Auth/model are owned by omp itself (`~/.omp/agent`); approvals bridge over omp's `extension_ui_request` channel (`ompApprovalBridge.ts`) into the same renderer approval flow the Claude path uses. Dev-first: `omp` is located on PATH (`ompLocator.ts`, `PI_OMP_PATH` override) — packaged-build Bun/omp sidecar bundling is a backlog item.
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
- **SDK session resume** — Claude backend: `sdk_session_id` on conversations (normal messages `resume`; regenerate/edit/compact/clear reset to full-history fallback; one-shot uses `persistSession: false`). omp (`'pi'`) backend: `pi_session_file` column stores the JSONL session path omp writes under `~/.omp/agent/sessions/`; a fresh turn captures it via `get_state.sessionFile`, a resumed turn passes `-r <file>` (and sends only the latest message since omp already holds prior history). One-shot (no conversationId) uses `--no-session`.
- **CWD whitelist** — `hooks_cwdWhitelist` (JSON `CwdWhitelistEntry[]`) replaces `writableKnowledgePaths`; CWD auto-included as readwrite, knowledge paths auto-merged
- **Engine-owned dispatch** — `AgentEngine.dispatch` (DispatchRegistry) is the canonical handler registry; Electron's `ipcMain` is a consumer via `bridgeDispatchToIpc()`; headless CLI uses dispatch directly
- **Headless CLI** — `node out/headless/index.js --server [--port N] [--access-mode lan|all] [--discord]` runs web server and/or Discord bot without Electron

## Conventions & Cascade
- **New IPC handlers**: register in `src/core/handlers/`, not `src/main/services/` — unless Electron-only (Category C: updater, quickChat, globalShortcuts, system, openscad, jupyter, tray, deeplink, protocol, waylandShortcuts, schedulerBridge, webhook)
- **DB query helpers**: use `getSetting(db, key)` from `src/core/utils/db.ts` and the named helpers in `src/core/db/queries.ts` (`getDefaultFolderId`, `countConversations`, `getBackgroundSchedulerEnabled`, `getDefaultModel`, `conversationExists`); inline `db.prepare("SELECT...").get()` is OK only for one-off queries with no callers elsewhere
- **Dedup baseline**: `npm run audit:check` after refactors; the committed baseline in `scripts/.dedup-baseline.json` is the floor — running `npm run audit:baseline` after an intentional improvement is encouraged, but PRs that increase clone counts should fix the cause or document why
- **CSS**: `@import` before `@tailwind` directives
- **Auth**: OAuth from `claude login`, NOT api_key
- **Themes**: CSS custom properties only — no hardcoded hex in renderer
- **Theme naming**: `base`/`body`/`contrast` (not `bg`/`text`/`text-contrast`) — avoids Tailwind collisions like `bg-bg`
- **Tinting**: `color-mix(in srgb, ...)` — Tailwind opacity modifiers don't work with raw CSS var values
- **Settings cascade**: Conversation > Folder > Global; `null`/`{}` = inherited
- **`hooks_cwdWhitelist` cascade**: replace semantics (most specific level wins); empty whitelist = backward compat (reads unrestricted, writes restricted to CWD)
- **NOT cascaded** (per-conversation only): `cwd`, `kb_enabled`, `cleared_at`
- **NOT cascaded** (global only): `tts_summaryModel` — model selection for TTS summary generation; UI provides Haiku/Sonnet/Opus presets + Custom free text; backend defaults to Haiku if unset
- **NOT cascaded** (global only): `ai_compactModel`, `ai_titleModel` — model overrides for `/compact` and auto-title; empty = Auto (inherits conversation's active model → `HAIKU_MODEL` fallback)
- **NOT cascaded** (global only): `server_passwordHash`, `server_sessionSecret`, `server_sessionDurationDays`, `server_rememberDurationDays` — server-scoped, not per-conversation
- **Folder color**: nullable TEXT `#rrggbb` validated server-side; `null` = no tint; applied via `color-mix` like theme tinting
- **Default folder**: `is_default = 1` on `folders`; auto-created at startup as "Unsorted" with `position = -1`; non-deletable, renamable; all new/imported conversations assigned to it; no `folder_id = NULL` in system
- **Heatmap**: `heatmap_enabled`, `heatmap_mode` (`'relative'`|`'fixed'`), `heatmap_min`, `heatmap_max` stored as strings; color via `hsvToHex(120 * (1-t), 70, 80)` applied same way; manual color takes precedence
- **Bulk IPC ops**: `deleteMany`/`moveMany` wrap per-row statements in `db.transaction()` — no `WHERE id IN (...)` (sql.js parameter binding limitation)
- **Multi-select `visibleOrder`**: store receives flat ID array from component — store cannot compute it (doesn't know folder expansion state)
- **`/compact`**: summarizes via `summarizeWithModel` helper — routes `claude-*` to Claude SDK, others to PI SDK; model resolved as `ai_compactModel` → `aiSettings.model` → `HAIKU_MODEL`; summary stored in `compact_summary` column on conversations table
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
- **Auto-title**: no `outputFormat: json_schema` — causes SDK internal tool_use cycle exhausting `maxTurns: 1`; model resolved as `ai_titleModel` → `aiSettings.model` → `HAIKU_MODEL`
- **Stream isolation**: `streamBuffers` dict keyed by conversationId — a conversation is streaming iff its ID is a key (no separate flag)
- **SDK session retry**: if `resume` fails (corrupted/deleted session), `streamAndSave` catches, clears `sdk_session_id`, and retries with full history — transparent to user
- **SDK session invalidation**: regenerate, edit, compact, clear all set `sdk_session_id = NULL` — SDK's internal history no longer matches SQLite
- **omp session persistence**: `pi_session_file` column on conversations stores the JSONL path omp wrote to (`~/.omp/agent/sessions/...`). `streamingOmp.ts` resolves per-turn: pass `-r <file>` when the column is set + file exists (omp resumes; only the latest user message is sent), else start fresh and capture `get_state.sessionFile` back into the DB. `/clear` (via `conversations:update`) and `/compact` both null the column; old session files stay on disk for audit
- **Compact summary injection**: `buildMessageHistory` prepends `compact_summary` as `[Previous conversation summary]` with role `assistant`
- **Cross-backend model mapping**: `ai_model` is shared across both SDK backends but the conventions differ (`claude-haiku-4-5-...` vs PI `provider/id`). `modelBackendMap.ts` (`core/services`, no `electron` import — also used by the renderer picker) translates the id to the active backend by FAMILY at the resolution seam in `assembleAISettings`; the stored setting is never rewritten (transparent + reversible). Non-mappable ids (e.g. `openai/gpt-4o` → Claude) fall back to `ai_lastModelByBackend[backend]` → `DEFAULT_MODEL`. `ai_lastModelByBackend` is written ONLY by the `settings:set` handler on an explicit native `ai_model` write (the resolver stays a pure reader). Mapping is applied before `summarizeWithModel`'s `isClaudeModel` routing for compact/title, and always to `claude-agent-sdk` for the TTS summary (it always uses the Claude SDK). Claude→PI is best-effort (core can't see PI's dynamic catalog).
- **Hook system messages**: `hook_response` output is JSON-parsed for `systemMessage` field — sent as `system_message` stream chunk with `hookName`/`hookEvent` metadata; non-JSON output silently ignored
- **UserPromptSubmit hooks**: SDK does not yield `hook_response` for this event — executed app-side via `hookRunner.ts`; system messages saved as `<hook-system-message>content</hook-system-message>` tags prepended to assistant content; extracted and rendered with accent-styled boxes + `MarkdownRenderer` (not plain text)
- **CWD whitelist read restriction**: only enforced when whitelist is non-empty; covers Read, Glob, Grep, Bash read commands (cat, head, tail, less, find, ls, tree, file, stat, wc, diff, strings, xxd)
- **omp host-tools (MCP + scheduler)**: `streamMessageOmp` assembles `OmpHostTool[]` (`buildOmpHostTools.ts`) — the scheduler tool (`ompSchedulerTool.ts`, trusted internal) + one host-tool per MCP tool (`mcpToOmpHostTools.ts`, spawned via `mcpClient.ts` wrapping `@modelcontextprotocol/sdk`, `mcp__<server>__<tool>` naming) — and registers them with `set_host_tools`. omp calls back via `host_tool_call` frames; `OmpRpcClient` runs the tool's `execute` and replies `host_tool_result`/`host_tool_update`. MCP spawn failures emit `system_message` chunks without aborting. omp's own built-in tools (read/bash/edit/write) run natively inside the subprocess — they are NOT host-tools and have no host-side per-tool interception (CWD-whitelist enforcement on them is a backlog gap).
- **omp approval gate**: omp surfaces tool approval as an `extension_ui_request` (`method:'select'`, options `['Approve','Deny']`, title `Allow tool: <name>…`) when `--approval-mode` isn't `yolo`. `ompApprovalBridge.ts` maps it to the SAME renderer flow the Claude path uses (`sendChunk('tool_approval')` → shared `pendingRequests` Map → `respondToApproval` → `extension_ui_response{value}`). permissionMode → `--approval-mode`: `bypassPermissions`→yolo, `acceptEdits`→write, everything else→always-ask. CRITICAL: the bridge registers the `pendingRequests` resolver BEFORE emitting the chunk (a synchronous responder would otherwise race the map insertion and hang).
- **omp MCP per-turn cost**: `streamMessageOmp` spawns and tears down MCP servers on every prompt (host-side). Long-lived or slow-to-start MCP servers incur full startup cost per message on the omp backend.

## Voice & STT Gotchas
- **STT backends**: `stt_backend` = `whisper` (external `whisper-cli` via `spawn`, main process) | `sherpa` (`sherpa-onnx-node` native addon, main process). Routing seam is `transcribeAudioBuffer.ts` (renderer); both send a 16 kHz WAV over IPC. Core logic in `core/services/sherpaStt.ts`, handlers in `core/handlers/sherpa.ts` (mirror whisper). The old renderer Parakeet (parakeet.js/WASM) engine was removed — sherpa subsumes it.
- **sherpa-onnx: native, NOT WASM**: use the `sherpa-onnx-node` npm package (native N-API addon, platform prebuilds), NOT `sherpa-onnx` (WASM build — fails on NeMo TDT decoders + can't hold a 600 MB+ encoder in WASM memory). API is a class: `new OfflineRecognizer(config)`, no `createOfflineRecognizer`.
- **Electron V8 memory cage**: native addons returning external buffers are rejected ("External buffers are not allowed"). Do NOT use sherpa's `readWave` (external Float32Array) in the main process — parse the WAV in JS (`parseWavPcm16`) into an in-cage `Float32Array` and pass it to `acceptWaveform`. Reading a JS buffer into C++ is fine; receiving a C++ buffer in JS is not.
- **Sherpa architecture auto-detection**: `detectArchitecture(fileNames)` maps a model folder's filenames to the sherpa family (transducer = encoder+decoder+joiner / whisper = encoder+decoder / paraformer / nemoCtc). Pure + testable; reported via `sherpa:validateConfig`. Models target the sherpa-onnx format (separate encoder/decoder/joiner), not raw NeMo/onnx-asr exports.
- **Sherpa preset catalog**: single source of truth in `core/services/sherpaPresets.ts` (edit ONE place if a HF link breaks); downloaded file-by-file from HF into `~/.agent-desktop/stt-models/<id>/` by `sherpaModelDownload.ts` (main).
- **`agent-model://` protocol** (`main/services/modelProtocol.ts`, was `parakeetProtocol.ts`): serves onnxruntime-web WASM (host `ort`) + bundled/custom wakeword models (hosts `hotword` / `hotword-model`) to the openWakeWord renderer worker. `onnxruntime-web` stays a (transitive) dep via `openwakeword-js`, NOT parakeet.js.

## Web Server Auth Gotchas
- **Password opt-in**: `server_passwordHash` null = current behavior (URL token). Non-null = HTML login gate + cookie; WS cookie-authed at upgrade, no `{type:'auth'}` needed.
- **Session revocation**: changing/clearing password rotates `server_sessionSecret` → all HMAC cookies invalidated (stateless, no session table).
- **HTTP fallback + password**: cookies travel clear-text when OpenSSL unavailable. Warn the user; still works.
- **Rate limit normalization**: `::ffff:` IPv6-mapped stripped (same as `isAllowedRemote`) or an attacker doubles the quota.
- **Cookie validation MUST precede scrypt verify**: rate limit check runs first, before the expensive scrypt call.
- **Settings `set(key, '')`**: deletes the row. Required for `clearPassword` to roundtrip through the `SettingsPort` adapter.
- **WS channel blocker narrowed**: only `server:start|stop|getStatus` blocked via WS now (was `startsWith('server:')`). Password channels reachable via shim.
- **PHC format is custom for scrypt**: `$scrypt$N=...,r=...,p=...$<salt>$<hash>` — parsed per-record so param bumps don't break verification of old hashes.

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
