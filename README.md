# Agent Desktop

Open-source Linux desktop client for Claude AI. Uses your existing Claude subscription via OAuth.

## Screenshots

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/0599fa5f-3470-4ed3-a1b8-5dd983c4a0af" />

## Features

- **Chat** with Claude using streaming responses, markdown rendering, code highlighting
- **Conversations** organized in folders with drag-and-drop, search, and export/import
- **Artifacts panel** for code, HTML, Mermaid diagrams, SVG, and markdown previews
- **Knowledge base** — attach files and folders as context for conversations
- **MCP servers** — connect Model Context Protocol tools
- **Custom tools** — define and test your own tool-use functions
- **Themes** — built-in dark/light themes with full CSS custom property customization
- **Keyboard shortcuts** — configurable, with defaults for common actions
- **System tray** — quick access to show/hide and create new conversations
- **Deep links** — `agent://conversation/<id>` protocol handler

## Installation

### AppImage

1. Download the `.AppImage` file from the [Releases](https://github.com/agent-desktop/agent-desktop/releases) page
2. Make it executable: `chmod +x Agent-Desktop-*.AppImage`
3. Run it: `./Agent-Desktop-*.AppImage`

### Debian / Ubuntu (.deb)

```bash
sudo dpkg -i agent-desktop_*.deb
```

### Prerequisites

- Linux (x64)
- An active Claude subscription — run `claude login` in your terminal first

## Development Setup

```bash
git clone https://github.com/agent-desktop/agent-desktop.git
cd agent-desktop
npm install
npm run dev
```

## Build

```bash
npm run build        # compile TypeScript (output: out/)
npm run dist:linux   # package AppImage + deb (output: release/)
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 33 |
| Frontend | React 18, TypeScript |
| State | Zustand |
| Styling | Tailwind CSS, CSS custom properties |
| Database | SQLite (better-sqlite3, WAL mode) |
| AI SDK | @anthropic-ai/sdk |
| MCP | @modelcontextprotocol/sdk |
| Markdown | react-markdown, remark-gfm, rehype-highlight |
| Diagrams | Mermaid |
| Build | electron-vite, electron-builder |

## Architecture

```
src/
  main/         Electron main process — SQLite, IPC services, tray, deep links
  preload/      contextBridge IPC glue (api.d.ts defines the contract)
  renderer/     React + Zustand + Tailwind — components, stores, pages
  shared/       TypeScript types shared between main and renderer
```

- **IPC pattern**: each service exports `registerHandlers(ipcMain, db)`
- **State**: Zustand stores per domain (auth, chat, conversations, artifacts, settings, etc.)
- **Styling**: CSS custom properties for theming, Tailwind for layout utilities
- **Database**: 13 tables, SQLite WAL mode, at `~/.config/agent-desktop/agent.db`

## License

[GPL-3.0](LICENSE)
