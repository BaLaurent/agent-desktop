# Changelog

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
