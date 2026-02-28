# Agent Desktop

Open-source desktop client for Claude AI — Linux, macOS, and Windows.

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/0599fa5f-3470-4ed3-a1b8-5dd983c4a0af" />

## Community

I build this project primarily for my own use — the features I add are the ones I need day to day. That said, feature requests are welcome! If there's something you'd like to see, drop a message on Discord and I'll consider it.

[![Discord](https://discord.com/api/guilds/1441514110893424735/widget.png?style=banner4)](https://discord.gg/qfeDTu65SX)


## Features

### Chat & Conversations
- Streaming responses with markdown rendering and syntax-highlighted code blocks
- Conversations organized in folders with drag-and-drop, search, and export/import
- **Message queue** — send messages while the AI is streaming; queued messages auto-send when the response finishes, with drag reorder, edit, and delete
- **Conversation fork** — right-click any message → "Fork from here" to branch into a new conversation
- `/compact` command — AI-powered context summarization that compresses long conversations while preserving key context
- `/clear` command — set an AI context boundary while preserving visible history
- **Multi-select** — Ctrl/Shift-click to select multiple conversations for bulk move or delete
- Right-click context menu on messages (copy, edit, retry, fork, TTS)
- Retry button on user messages (hover or context menu)
- Slash command autocomplete with fuzzy matching
- Configurable max turns (including unlimited)
- Native SDK session resume — faster conversation continuity without re-sending full history

### Authentication
- **OAuth** — use your existing Claude subscription via `claude login`
- **API key** — bring your own Anthropic API key with custom base URL and model selection

### AI Backend
- **Claude Agent SDK** (default) — full-featured backend with session resume, tools, and MCP support
- **PI Coding Agent** *(experimental)* — alternative backend via the PI Coding Agent SDK; selectable per-conversation, per-folder, or globally in settings. Not yet fully integration-tested — expect rough edges
  - For sub-agent support, [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) is a tested and working extension (other extensions may work too)

### File Explorer & Viewers
- Built-in file explorer with context menu (open, rename, duplicate, move to trash, open in terminal)
- Code viewer (Monaco), HTML sandbox, Markdown preview, Mermaid diagrams, SVG renderer
- **3D model preview** — OpenSCAD files rendered with Three.js, with STL export
- **Jupyter notebook** — `.ipynb` preview with live kernel execution and inline cell editing (Colab-style)
- Image preview (base64 data URL), fullscreen preview modal
- `@mention` autocomplete with VS Code-style fuzzy matching and configurable exclude patterns

### Knowledge Base
- Attach files and folders as context for conversations
- Read-only and read-write collection modes
- 500KB cumulative size guard with per-conversation selection

### Quick Chat
- Global overlay (configurable shortcut) for quick agent interactions from anywhere on the desktop
- Text and voice modes with separate conversation tracking
- Voice input via local whisper.cpp — audio processed locally, never sent to a server
- Audio ducking — system volume auto-lowers during voice recording
- Headless mode — notifications-only without overlay window

### Text-to-Speech
- AI responses read aloud via configurable TTS providers
- **Providers**: Piper (HTTP), edge-tts (CLI), spd-say (system speech-dispatcher)
- **Response modes**: full, summary, auto (full if short, summary if long), off
- **Configurable summary model** — choose Haiku, Sonnet, or Opus for TTS summaries
- Per-stream audio ducking — other audio lowers while TTS plays
- Per-conversation TTS settings via AI overrides cascade

### Scheduled Tasks
- Recurring task execution on conversations
- Schedule agent actions to run automatically on a configurable interval
- Built-in MCP bridge — AI can create, list, and cancel scheduled tasks directly

### Tools & Extensions
- **MCP servers** — connect stdio, HTTP, or SSE Model Context Protocol tools
- **Setting Sources** — granular control over user/project/local settings discovery (CLAUDE.md, commands, hooks, skills)
- **UserPromptSubmit hooks** — run custom hooks before each message, with markdown-rendered system messages
- **CWD whitelist** — configurable directory access with per-entry read/readwrite permissions
- Per-skill enable/disable and per-conversation MCP server selection
- Configurable permission modes and allowed tools

### Customization
- Built-in dark/light themes with full CSS custom property editor
- Custom theme creation and import from `~/.agent-desktop/themes/`
- **Folder heatmap** — auto-color folders by conversation count (green → red), with relative and fixed modes
- **Folder color tinting** — custom per-folder color picker with HSV canvas
- **Default folder** — auto-created "Unsorted" folder; all new conversations auto-assigned
- Configurable keyboard shortcuts (app and global)
- Configurable desktop notifications (hidden/unfocused/always trigger modes)
- System tray with quick access, theme-aware icons

### Global Shortcuts (Linux)
- Quick Chat, Quick Voice, and Show App shortcuts
- **X11**: native Electron `globalShortcut`
- **Wayland**: XDG Desktop Portal integration, with Hyprland-specific FIFO dispatch
- Supported compositors: KDE Plasma 5.27+, Hyprland, GNOME 47+

### Auto-Update
- Built-in update system via electron-updater with GitHub Releases
- Checks on startup (10s delay) then every 4 hours; opt-in download, installs on restart
- **AppImage** (Linux): in-app silent download and install
- **deb** (Linux): redirects to GitHub releases page (no delta updates)
- **macOS**: downloads a zip in the background, replaces the `.app` bundle and restarts
- **Windows** (NSIS installer): in-app silent download and install via NSIS

## Installation

### Prerequisites

**Option A — OAuth (Claude subscription):**
- An active Claude subscription
- The [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed (`npm install -g @anthropic-ai/claude-code`)
- Run `claude login` in your terminal before first launch

**Option B — API key:**
- An Anthropic API key
- Configure it in Settings > AI > API Key after launch

### Linux

Download from the [Releases](https://github.com/BaLaurent/agent-desktop/releases) page.

**AppImage:**
```bash
chmod +x Agent-Desktop-*.AppImage
./Agent-Desktop-*.AppImage
```

**Debian / Ubuntu:**
```bash
sudo dpkg -i agent-desktop_*.deb
```

### macOS (Apple Silicon)

1. Download the `.dmg` from the [Releases](https://github.com/BaLaurent/agent-desktop/releases) page
2. Open the `.dmg` and drag **Agent Desktop** to your Applications folder
3. On first launch: right-click the app → **Open** (required for unsigned apps)

### Windows

Download from the [Releases](https://github.com/BaLaurent/agent-desktop/releases) page.

- **Installer** (`Agent Desktop Setup *.exe`): NSIS installer with custom install directory
- **Portable** (`Agent Desktop *.exe`): no installation needed

## Development Setup

```bash
git clone https://github.com/BaLaurent/agent-desktop.git
cd agent-desktop
npm install
npm run dev
```

### Build

```bash
npm run build        # compile TypeScript (output: out/)
npm run dist:linux   # package AppImage + deb (output: release/)
npm run dist:mac     # package .dmg for macOS arm64 (output: release/)
npm run dist:win     # package .exe installer + portable for Windows x64 (output: release/)
```

### Testing

```bash
npm test             # run all tests (main + renderer)
npm run test:main    # main process tests only
npm run test:renderer # renderer tests only
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 33 |
| Frontend | React 18, TypeScript |
| State | Zustand |
| Styling | Tailwind CSS, CSS custom properties |
| Database | SQLite (sql.js, WASM) |
| AI | @anthropic-ai/claude-agent-sdk, PI Coding Agent SDK *(experimental)* |
| MCP | @modelcontextprotocol/sdk |
| Markdown | react-markdown, remark-gfm |
| Diagrams | Mermaid |
| 3D | Three.js, @react-three/fiber, @react-three/drei |
| Code Editor | Monaco Editor |
| Jupyter | jupyter_client + ipykernel (local kernel) |
| Voice | whisper.cpp (local) |
| Build | electron-vite, electron-builder |

## Architecture

```
src/
  main/         Electron main process — SQLite, IPC services, tray, shortcuts, auto-update
  preload/      contextBridge IPC glue (api.d.ts defines the contract)
  renderer/     React + Zustand + Tailwind — components, stores, pages
  shared/       TypeScript types and constants shared between main and renderer
```

- **IPC pattern**: each service exports `registerHandlers(ipcMain, db)`
- **State**: Zustand stores per domain (auth, chat, conversations, settings, etc.)
- **Theming**: CSS custom properties in theme files, mapped through Tailwind config
- **Database**: SQLite WAL mode at `~/.config/agent-desktop/agent.db`
- **AI settings cascade**: Conversation > Folder > Global (with JSON overrides)


## Changelog

### v0.8.0

**Message Queue**
- Queue messages while the AI is still streaming — they auto-send when the current response finishes
- Drag-to-reorder queued messages, inline edit, delete
- Random 1–5s delay between queued messages to avoid rate limiting
- Queue auto-pauses on stop, regenerate, edit, compact, and clear

**Conversation Fork**
- Right-click any message → "Fork from here" to create a new conversation branching from that point
- Copies all settings, overrides, and messages up to the fork point
- Respects `/clear` boundaries and preserves compact summaries

**`/compact` Command**
- AI-powered context summarization — compresses the entire conversation into a summary
- Summary injected as context for the AI on subsequent messages
- Configurable summary model (defaults to Haiku)

**SDK Native Session Resume**
- Conversations reuse the SDK session for faster continuity — only the last message is sent instead of full history
- Auto-fallback to full history if session is invalid (fork, regenerate, edit, compact, clear all reset the session)
- Transparent retry on session corruption

**Default Folder System**
- Auto-created "Unsorted" folder replaces the old Unfiled section
- All new and imported conversations are auto-assigned to the default folder
- Default folder is protected from deletion; deleting other folders reparents their conversations to it

**Folder Heatmap & Color Tinting**
- Folders auto-colored by conversation count: green (few) → red (many)
- Two modes: relative (scales to max folder) and fixed (manual min/max thresholds)
- Custom per-folder color via HSV canvas picker, overrides heatmap
- Color applied via `color-mix` tinting on folder background

**Multi-Select Conversations**
- Ctrl/Cmd-click to toggle individual selection, Shift-click for range select
- Bulk actions: move to folder, delete
- Batch operations wrapped in DB transactions for consistency

**Message UI Improvements**
- Right-click context menu on all messages (copy, edit, retry, schedule, fork, TTS)
- Hover retry button on user messages
- Adjacent sub-agent (Task) tool blocks grouped into collapsible sections
- Inline edit with dynamic textarea sizing

**UserPromptSubmit Hooks**
- Custom hooks run before each message is sent to the AI
- Hook output rendered as accent-styled system message blocks with full markdown support
- Persisted in message content as `<hook-system-message>` tags

**CWD Whitelist**
- Configurable directory access with per-entry read or readwrite permissions
- Knowledge folders auto-merged into the whitelist
- Cascades through the settings hierarchy (conversation > folder > global)
- UI editor in AI settings panels at all levels

**TTS Summary Model**
- Choose which Claude model generates TTS summaries: Haiku, Sonnet, or Opus
- Global-only setting (not cascaded per-conversation)
- Defaults to Haiku if not configured

**File Explorer**
- "Open in Terminal" action in context menu for files and directories

**Bug Fixes**
- Tab key now inserts a tab character in the message input instead of moving focus
- Keyboard shortcuts harmonized between send bar and edit bar (Enter/Ctrl+Enter behavior)
- Conversation `updated_at` now updates on edit and regenerate (fixes sort order)
- Hook system messages render markdown correctly and persist across sessions

**Internal**
- Shared `ContextMenu` component extracted and used across sidebar and chat
- `buildLastUserMessage()` extracted from messages service for SDK session resume logic
- `groupStreamParts` utility for collapsible Task block rendering
- Test suite expanded: 1510 tests (870 main + 640 renderer) with coverage thresholds (70% lines, 60% branches)

## License


[AGPL-3.0](LICENSE)
