# Changelog

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
