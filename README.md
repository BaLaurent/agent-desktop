# Agent Desktop

Open-source desktop client for Claude AI — Linux, macOS, and Windows.

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/0599fa5f-3470-4ed3-a1b8-5dd983c4a0af" />

## Features

### Chat & Conversations
- Streaming responses with markdown rendering and syntax-highlighted code blocks
- Conversations organized in folders with drag-and-drop, search, and export/import
- `/clear` command — set an AI context boundary while preserving visible history
- Slash command autocomplete with fuzzy matching
- Configurable max turns (including unlimited)

### Authentication
- **OAuth** — use your existing Claude subscription via `claude login`
- **API key** — bring your own Anthropic API key with custom base URL and model selection

### File Explorer & Viewers
- Built-in file explorer with context menu (open, rename, duplicate, move to trash)
- Code viewer (Monaco), HTML sandbox, Markdown preview, Mermaid diagrams, SVG renderer
- **3D model preview** — OpenSCAD files rendered with Three.js, with STL export
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

### Scheduled Tasks
- Recurring task execution on conversations
- Schedule agent actions to run automatically on a configurable interval

### Tools & Extensions
- **MCP servers** — connect stdio, HTTP, or SSE Model Context Protocol tools
- **Setting Sources** — granular control over user/project/local settings discovery (CLAUDE.md, commands, hooks, skills)
- Per-skill enable/disable and per-conversation MCP server selection
- Configurable permission modes and allowed tools

### Customization
- Built-in dark/light themes with full CSS custom property editor
- Custom theme creation and import from `~/.agent-desktop/themes/`
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
- AppImage: in-app download and install
- deb: redirects to GitHub releases page

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
| Database | SQLite (better-sqlite3, WAL mode) |
| AI | @anthropic-ai/claude-agent-sdk |
| MCP | @modelcontextprotocol/sdk |
| Markdown | react-markdown, remark-gfm |
| Diagrams | Mermaid |
| 3D | Three.js, @react-three/fiber, @react-three/drei |
| Code Editor | Monaco Editor |
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

## Community

Have ideas, feature requests, or just want to chat about the project? Join us on Discord — we'd love to hear from you.

[![Discord](https://img.shields.io/discord/1332757770099806208?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.gg/qfeDTu65SX)

## License

[GPL-3.0](LICENSE)
