# Changelog

## [Unreleased]

### New Features
- **Native Omarchy front end** — the Omarchy plugin at `omarchy/plugins/agent-desktop/` is now a full QML application over the headless server, not just a quick-chat overlay. `SUPER + A` opens a real Hyprland toplevel with conversations, chat, settings, files, git, scheduler, notebook and OpenSCAD surfaces; `ALT + SPACE` still opens the quick-chat card, and both share one chat implementation. The React front stays in the repo as the cross-platform / remote-browser client — nothing was removed from it.
  - The plugin's Node bridge is now a transparent channel proxy: one generic `invoke` op carries every one of the server's ~120 channels and forwards every push verbatim, so adding a surface needs no bridge change. It ships as a bundled artifact, so it runs from `~/.config/omarchy/plugins` without the repo's `node_modules`.
  - The settings page is *generated* from `SETTING_DEFS` in `src/core/types/constants.ts` rather than hand-copied, so the QML and React settings pages cannot drift. CLI-pinned settings (`settings:getLocked`) now render disabled with the reason — something the React UI never showed.
  - Theme, palette, typography and spacing come from the Omarchy shell singletons, so the window follows the active Omarchy theme. The renderer's CSS theme system is deliberately not ported.
  - Web-UI escape hatches are gone: `SUPER + A` no longer launches a browser, and no code path in the plugin can open one.

- **Continuous voice in the native Omarchy front** — always-listening capture now works in the QML plugin, which previously had no controls for it at all (`continuousVoice_*` was documented as "NOT BUILT"). The bridge runs a continuous `pw-record` and cuts it into utterances with the same energy VAD the renderer uses — `vadStateMachine` moved to `src/core/services/` so both fronts segment identically instead of drifting. Each utterance is transcribed through the configured STT backend and passed through a port of the renderer's voice gate: the follow-up window, the intent classifier (`voice:classifyIntent`) and its fail-closed behaviour are all faithful. The wake-word gate matches the TRANSCRIBED text rather than the audio, because openwakeword-js runs in a browser Web Worker and has no non-DOM equivalent; the Voice Input settings page says so where you choose the gate.

### Bug Fixes
- **The backend selector — and every other generated setting row — is back on the QML AI / Model page.** `AiModelSettings` rendered a `visibleDefs` property that nothing ever assigned (the page passed `settingDefs`), so its Repeater iterated an empty list and all 19 rows were missing: agent name, personality, language, max turns, permission mode and, most visibly, Backend. There was no way to switch between the Claude Agent SDK and Oh My Pi from the UI at all.
- **Select rows on the QML settings page can show and change their value.** Every `select` row rendered an empty dropdown under a red "Stored value 'claude-agent-sdk' is not in the option list", for values that were in the list. A def reaching a Repeater delegate as `modelData` is a marshalled copy whose `options` is a QML variant list, so the `Array.isArray` guard in `settingsRows.js` rejected it and `optionIndexFor` answered -1; the row's own `Array.isArray` check separately handed the Dropdown zero options. Both now go through one duck-typed `optionsOf` normalizer.
- **Headless voice mode is actually headless.** `quickChat_voiceHeadless` ("notifications only, no overlay") had no reader anywhere in the QML front, and the decision was then taken against a settings map that a cold summon has not loaded yet — so the fallback won and the shortcut opened the ordinary quick-voice overlay every time. A voice summon now waits for the settings map, then either summons the overlay or runs a windowless session: capture, transcribe, send, and the agent's answer as a desktop notification, gated on `quickChat_responseNotification` (which also had no reader). `omarchy-shell agent-desktop status` reports `waking` / `listening` / `transcribing` so a mode with no window can still be observed.
- **No conversation could be created from the QML front.** Both creation paths sent `[title, null]` to `conversations:create`, and the server treats an absent `folderId` as "use the default folder" while refusing an explicit null (`folderId must be a positive integer`). The sidebar's new-conversation button and every quick-chat resolution were rejected — silently, because the quick-chat call carried no error callback. Arguments now omit what they don't have, failures surface on the store, and the created-id fallback matches the title it asked for, so "Separate conversations for text and voice" finally produces a `Quick Chat (Voice)` instead of adopting the text one.
- **`mcp:testConnection` is reachable from the local front again** — a new loopback-only dispatch origin (`ws-local`) lets a same-host client reach MCP management, git `fetch`/`checkout`, `files:prepareSession`, `files:openTerminalHere` and the storage purges, while a LAN browser still gets `Channel not available via WebSocket`. `WS_BLOCKED_CHANNELS` (e.g. `server:setPassword`) stays absolute for both. Verified live from both a loopback and a LAN socket.
- **omp extension dialogs can be answered by a non-Electron client** — `emitPIUIRequest` already broadcast to WebSocket clients but the only reply path was Electron IPC, so a web or QML front could see an `editor` dialog and never answer it, hanging the turn until `cancelPendingPIUI`. The WS server now accepts a `respond` frame from an authenticated client.
- **TTS speaking state reaches non-Electron clients** — `tts:stateChange` was broadcast from `src/main/services/tts.ts`, which the headless server never imports, so nothing registered the listener and the event was emitted to nobody: `tts:speak` worked and audio played while every web and QML client showed a permanently dark speaking indicator. The broadcast now happens in `src/core/handlers/tts.ts`, and the listener is a set rather than a single slot so the Electron window handler and the broadcast handler no longer silently replace each other depending on import order.
- **Database durability hardened** — settings and message writes now flush to disk immediately when isolated (bursts still coalesce on a 500ms debounce), and every flush writes to a temp file renamed atomically over `agent.db`, so a crash or kill mid-flush can no longer truncate the database.

### Internal
- **`pi:listExtensions`, `jupyter:*` and `openscad:*` moved from `src/main/services/` into `src/core`** — they had no real Electron coupling beyond `sendToRenderer`, which is now `broadcast(...)`, so both fronts reach them through the same `engine.dispatch` mirror. `openscad:exportStl` takes an explicit `outputPath` instead of opening a save dialog inside the handler, which is what let it leave `WS_BLOCKED_CHANNELS`; the Electron renderer opens its own dialog first.

## [0.18.0] - 2026-06-15

### New Features
- **Continuous voice mode** — hands-free, always-listening conversation: a local wakeword engine (openWakeWord) arms the mic and an intent gate decides when to actually send, so you can talk to the agent without touching the keyboard
- **Local speech-to-text via sherpa-onnx** — a new native STT backend (`sherpa-onnx-node`) replaces the previous Parakeet engine: transcription runs fully on-device, with a downloadable model preset catalog (Parakeet v3 multilingual), one-click HuggingFace downloads, a manual model-folder option, and a settings panel with a detection report. Model downloads stream to disk instead of buffering the full encoder in memory
- **Pause media during voice input (opt-in)** — when enabled, any playing MPRIS media player (Spotify, browsers, …) is paused while you dictate and resumed afterward, so background audio doesn't bleed into your recording
- **Quick Voice audio cues** — a short rising tone plays when Quick Voice starts recording and a descending tone when it stops, so you know when capture begins and ends. Works in both the visible overlay and headless (notifications-only) mode

### Bug Fixes
- **TTS no longer speaks the model's reasoning** — `<thinking>…</thinking>` blocks (persisted in assistant content for renderer replay) are now stripped before TTS, so they are neither spoken nor fed to the summary model. Strip logic centralized in a single `stripThinkingBlocks` helper reused by history replay, auto-title, compaction, and TTS
- **TTS plays in the web client** — when you drive text-to-speech from the web/mobile client, the generated audio (Piper, edge-tts) is now streamed to the browser and played there, instead of only playing on the server machine. Local playback is skipped while a web client is connected; the desktop app is unaffected. (Direct-playback providers `spd-say`/`say` remain server-only.)
- **TTS stop no longer logged as a playback error** — `mpv` (and similar players) trap `SIGTERM` and exit gracefully with a non-zero code (mpv exits 4) instead of dying by signal. Deliberately stopping playback — at the start of each new utterance, via the stop-TTS shortcut, or when the Quick Voice overlay closes — no longer surfaces a spurious `Audio player mpv exited with code 4` error. Genuine playback failures are still reported.
- **AskUserQuestion answers are no longer dropped** — when the agent asked a multiple-choice question, your selection was ignored and the agent silently proceeded with its defaults. The Claude Agent SDK matches answers to questions by the full question text, but the UI clients keyed their submitted answers by the short header (web/desktop) or by question index (Discord), so the SDK saw no match and recorded "the user did not answer." Answers are now normalized to question-text keys at the single shared `canUseTool` chokepoint (accepting index, header, or text from any client), and a cancelled/aborted question is surfaced as a proper denial instead of leaking an empty answer set.

### Internal
- **`tsc` type-checks cleanly across all three projects** — added the missing `tsconfig` project references (node/web reference core) and excluded test files from the app type-check, then fixed the pre-existing type errors this surfaced (SDK type drift in the PI pipeline, DB adapter boundary casts, React 19 ref typing, `WebkitAppRegion` CSS augmentation, preload event-callback typing, and more). The PI SDK loader/model-registry modules moved from `src/main/services` to `src/core/services/pi` to break a core to main dependency cycle. No runtime behavior change.

---

## [0.17.0] - 2026-05-27

### New Features
- **Partial replies survive a manual stop** — stopping a streaming reply now keeps whatever the assistant had already written and flags it with an `Interrupted` marker, instead of discarding the turn. Backed by a new `stopped` column on the messages table
- **Agent persona & language directives** — new free-text `Personality` and `Language` settings (cascade conversation > folder > global) injected into the system prompt and reused by the TTS summary, so a conversation can keep a consistent voice and reply language
- **CSV files render as tables** — `.csv` files in the preview pane are parsed and displayed as real tables instead of raw text

### Bug Fixes
- **TTS summary restored** — the spoken-summary feature was broken; it works again, and the structured logger no longer swallows the underlying errors
- **Web/mobile stream recovery** — long-running streams that went silent after a transport drop are now recovered instead of hanging
- **Logging** — `warn`/`info` now preserve an `Error`'s `cause` via `errToCtx` (the cause was previously discarded)

### Under the Hood
- Settings reads routed through the `getSetting` helper (single source for setting access)
- Removed an unfinished `anthropic` token-counter mode (dead code)
- Ignore `.understand-anything` analysis output in git

### Tests
- Full suite green: **2442 main + 1234 renderer**

### Install
- Linux — AppImage / .deb (x86_64 + arm64)
- Windows — NSIS installer / portable .exe
- Auto-update enabled on AppImage + NSIS

---

## [0.16.1] - 2026-05-18

### Bug Fixes
- **Cross-backend model selection** — `ai_model` is shared across the Claude and PI backends, but the two SDKs use different id conventions (`claude-haiku-4-5-...` vs PI `provider/id`). Switching backend no longer silently falls back to the SDK default: the stored id is now translated by family (haiku/sonnet/opus) at the resolution seam. The setting is never rewritten, so switching back restores the original model. Non-mappable ids (e.g. `openai/gpt-4o` → Claude) fall back to the last natively-selected model for that backend, then the default
- **`/compact` & auto-title routing** — the effective compact/title model is now mapped before the Claude-vs-PI routing decision, so a PI-style override no longer routes to the wrong SDK
- **TTS summary** — summary model id is mapped to Claude convention (the TTS summary always runs through the Claude SDK)

### Under the Hood
- New pure `core/services/modelBackendMap.ts` module (no `electron` import; reused by the renderer picker); mapping applied at the single `assembleAISettings` seam; `ai_lastModelByBackend` written only on explicit native selection so the resolver stays a pure reader
- Settings picker (incl. compact/title selects) now displays the effective mapped model for the active backend

### Tests
- +25 cases (model map module, resolver integration, settings handler tracking)
- Total: **3628 tests** (2420 main + 1208 renderer) — all green

### Install
- Linux — AppImage / .deb (x86_64 + arm64)
- Windows — NSIS installer / portable .exe
- Auto-update enabled on AppImage + NSIS

---

## [0.16.0] - 2026-05-13

### New Features
- **Assistant thinking blocks persisted** — extended-thinking output is now stored alongside assistant messages and rendered back on conversation reload (collapsible block, same UX as a live stream)
- **Structured logger** — new `createLogger(name)` API in `core/utils/logger.ts` with `trace/debug/info/warn/error` levels and `child()` for sub-loggers; 240+ `console.*` call sites migrated; renderer auto-falls back to `console` when `process.stdout` is undefined

### Bug Fixes
- **Web shim** — `settings:set` no longer blocked over WebSocket; git namespace restored so remote sessions can hit git IPC
- **UserBubble** — TTS button removed from user messages (only assistant text is speakable)
- **Slash dropdown** — popup now stretches to its parent width so command descriptions truncate cleanly instead of overflowing
- **Picker** — new `align` prop on the popup so the status line picker stops overflowing the right edge

### Under the Hood (Fallow Session 2 — Grade B → A)
- **Zero circular dependencies in `src/main/`** — introduced `mainContext.ts` as the DI seam; services import `getMainWindow` from `'../mainContext'` instead of `'../index'`. All 20 cycles broken, backward-compat shim kept on `index.ts`
- **Module hotspot salvages** — split MessageBubble (CRAP 2352 → dispatchers), ToolUseBlock (1122 → 30), ansiToHtml (1056 → 42), cwdRestrictionHook (1122 → 210), createSession (1190 → <30), scheduler.update (812 → 56), enrichEnvironment / OverrideFormFields / SkillsPromptSection (1200+ → <500), and ~10 more
- **Dead code purge** — liquidated unused exports/types/members, dropped orphan ports barrel, aligned dependencies with actual usage
- **Health score** — fallow `health_score` 81.8 (B) → **93.0 (A)**

### Tests
- +290 tests on handler hotspots (Phase 3 coverage push)
- Total: **3547 tests** (2339 main + 1208 renderer) — all green

### Install
- Linux — AppImage / .deb (x86_64 + arm64)
- Windows — NSIS installer / portable .exe
- Auto-update enabled on AppImage + NSIS

---

## [0.7.0] - 2026-02-25

### New Features
- **Web server remote access** — HTTP + WebSocket server for LAN access from phone/tablet with QR code auth, auto-reconnect, and binary data support
- **Mobile ergonomics** — touch-optimized UI with `compact:` Tailwind variant, 44px touch targets, `100dvh` viewport, edge swipe gestures
- **Unified ExpandedViewerModal** — replaces separate CodeEditorModal/PreviewModal with a single full-screen viewer for all file types
- **Default model upgrade** — Claude Sonnet 4.6 as default model
- **Global stop TTS shortcut** — `Ctrl+Shift+T` works outside app focus (OS-level registration)
- **ARM64 builds** — Linux and Windows now available for arm64 architecture

### Mobile & Web Mode
- File attachments via upload shim in web mode
- Conversation state persisted to sessionStorage (survives Android browser kill/reload)
- Auto-reopen file picker after interrupted upload on page reload
- Edge swipe gestures: left edge → sidebar, right edge → file explorer
- Swipe-to-dismiss for overlay panels
- Compact sidebar header for small screens
- Two-row input layout on narrow viewports
- Safe area insets for notched devices

### Security
- Block unsafe IPC channels (`server:*`, `openscad:exportStl`) from WebSocket bridge
- WebSocket blocklist defense-in-depth (server-side + shim-side)

### Bug Fixes
- Fix BrowserWindow `minWidth` causing horizontal overflow on Wayland compositors

### Tests
- +49 new tests: useEdgeSwipe (17), fileToAttachment (28), WebSocket blocklist (4)
- Total: 1083 tests passing (677 main + 406 renderer)

---

## [0.6.0] - 2026-02-20

### New Features
- **Multi-file selection** — Ctrl+click (toggle) and Shift+click (range) in file explorer; "New Conversation from Files" with copy/symlink + inline rename
- **Per-message TTS replay** — Play/Stop button on assistant messages (hover or while speaking)
- **Collapsible Unfiled section** — sidebar Unfiled group collapses with persisted state

### Improvements
- **sql.js WASM migration** — replaced better-sqlite3 with sql.js (pure WASM); no native module ABI issues
- **Cross-window refresh** — Quick Chat messages sync to main app via IPC broadcast
- **macOS TTS** — `say` command support for text-to-speech on macOS
- **macOS auto-update** — auto-update support for macOS builds

### Bug Fixes
- Fix Mermaid diagram text disappearing (relaxed DOMPurify config for `foreignObject`/`use` tags)
- Fix AppImage auto-update filename mismatch (`artifactName` template)

### Tests
- voiceInputStore tests, notifyConversationUpdated coverage, prepareSession backend tests

---

## [0.5.0] - 2026-02-17

### New Features
- **Jupyter notebook editing** — inline cell editing (Colab/Jupyter style) with add/delete/move cells, dirty tracking, and nbformat 4 serialization
- **Jupyter kernel execution** — live cell execution via local Jupyter kernel (Python bridge, JSON Lines protocol)
- **Text-to-Speech system** — piper, edge-tts, spd-say providers; auto/full/summary modes with Haiku summarization
- **Scheduler bridge MCP** — internal MCP server for scheduled task creation from conversations
- **Audio ducking** — per-stream PulseAudio ducking during TTS playback

### Bug Fixes
- Fix scheduler MCP: use newline-delimited JSON protocol
- Fix TTS: duck individual audio streams instead of system volume

---

## [0.4.0] - 2026-02-15

### New Features
- **Scheduled tasks** — recurring execution on conversations with cron-like scheduling
- **API key auth** — custom API key, base URL, and model support (beyond OAuth)
- **OpenSCAD 3D preview** — native 3D model viewer with Three.js + STL export
- **JetBrains Mono font** — bundled monospace font for consistent code rendering

### Bug Fixes
- Fix code blocks without language rendered as inline code

---

## [0.3.2] - 2026-02-14

### New Features
- **Fullscreen preview modal** — expand button for file explorer viewers
- **Markdown anchor links** — headings get slugified IDs; `#` links scroll within container

### Bug Fixes
- Fix markdown anchors with URL-encoded accented characters
- Fix global shortcuts on AppImage: replace D-Bus signals with FIFO pipe

### Improvements
- Audio ducking for Quick Voice overlay (PulseAudio volume control)

---

## [0.3.1] - 2026-02-13

### New Features
- **Auto-update** — electron-updater with GitHub Releases (check on startup + every 4h)
- **Configurable streaming timeout** — Settings > General; 0 = no timeout
- **Setting Sources** — renamed from Skills; granular control over settings.json/CLAUDE.md/commands/hooks

### Bug Fixes
- Fix modifier key handling: distinguish Super from Ctrl on Linux
- Fix Wayland shortcut re-registration and Quick Voice overlay lifecycle
- Fix show-app shortcut: unify toggle logic with tray
- Fix skill list truncation: keep name visible, crop description only
- Fix hyprctl double-trigger: unbind before bind to clear stale bindings

---

## [0.2.0] - 2026-02-12

### New platforms
- **macOS (Apple Silicon)** — ARM64 DMG build via `npm run dist:mac`
- **Windows** — NSIS installer + portable x64 build via `npm run dist:win`

### New features
- **App icon** — high-resolution icon (`.icns`, `.ico`, `.png`) for macOS, Windows and Linux
- **macOS tray icon** — monochrome menu bar icon (`trayTemplate.png` / `@2x`), macOS template image that automatically adapts to light and dark menu bar themes

### macOS fixes
- **Expired OAuth token** — `ensureFreshMacOSToken()`: before every SDK call, the token is checked and automatically refreshed via the OAuth endpoint if expired. The new access token and refresh token are saved back to the Keychain. On failure (`invalid_grant`), a clear message prompts the user to run `claude login` again.
- **Dynamic OAuth constants** — `CLIENT_ID` and `TOKEN_URL` are now read directly from the installed SDK's `cli.js` bundle (no more hardcoded values)
- **Keychain authentication** — credentials are read from the macOS system Keychain (`security find-generic-password`) in addition to the `.credentials.json` file
- **Credentials path** — `CLAUDE_CONFIG_DIR` correctly resolved on macOS
- **GPU / rendering** — Ozone/EGL/VAAPI flags are now Linux-only (they caused a crash at startup on macOS)
- **PATH enrichment** — automatically appends `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `~/.volta/bin` on macOS; resolves the default nvm node bin directory

### UI fixes
- **Window title bar** — text color fixed (`text-body` instead of `text-primary`): readable in both dark and light themes
- **User profile** — the top-right menu now shows the real name and email of the logged-in user (read from `~/.claude/.claude.json` → `oauthAccount`) instead of the hardcoded "Claude User"
- **Error message display duration** — error messages now stay visible long enough to be read

### Voice input (Whisper)
- **macOS microphone permission** — `NSMicrophoneUsageDescription` added to `Info.plist` via `extendInfo` in `electron-builder.yml`
- **MediaRecorder MIME type** — explicit `audio/webm;codecs=opus` selection (with `audio/webm` fallback) for macOS compatibility
- **AudioContext sample rate** — removed hardcoded `sampleRate: 48000`; uses the device's native rate to avoid resampling artifacts
- **Microphone error message** — macOS-specific guidance: *"Go to System Settings > Privacy & Security > Microphone"*

---

## [0.1.0] - 2026-02-11

Initial public release — Electron + React desktop client for Claude AI (Linux AppImage/deb).
