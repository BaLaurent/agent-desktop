# Agent Desktop
A desktop client for every LLM, built for agents. Claude by default — any model via a custom base URL. Plan mode approvals, MCP servers, a real git panel, a scheduler with variables, voice, Jupyter — wired straight to your filesystem, or headless in a Docker sandbox if that's your vibe. 

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/0599fa5f-3470-4ed3-a1b8-5dd983c4a0af" />

> **Full documentation lives on the [Agent Desktop Wiki](https://agent-desktop.wiki)** — features, headless server, architecture, changelog, and guides.

## Community

I build this project primarily for my own use — the features I add are the ones I need day to day. Feature requests are welcome on Discord.

[![Discord](https://discord.com/api/guilds/1441514110893424735/widget.png?style=banner4)](https://discord.gg/qfeDTu65SX)

## Highlights

- **Chat** — streaming, markdown, syntax highlighting, message queue, conversation fork, `/compact`, `/clear`
- **Auth** — OAuth via Claude subscription or your own Anthropic API key
- **Backends** — Claude Agent SDK (default) or PI Coding Agent *(experimental)*
- **Files** — built-in explorer, Monaco code viewer, Mermaid, OpenSCAD 3D, Jupyter notebooks
- **Knowledge base** — attach files/folders as conversation context
- **Quick Chat** — global overlay with text + voice (local whisper.cpp)
- **TTS** — Piper, edge-tts, or spd-say with summary modes
- **Scheduled tasks** — recurring agent runs with prompt variables
- **MCP** — stdio, HTTP, and SSE Model Context Protocol servers
- **Themes** — full CSS custom property editor, day/night auto-switch, folder color tinting
- **Git panel** — status, branches, stash, DAG graph, log
- **Headless mode** — runs as a web server and/or Discord bot without Electron
- **Auto-update** — built-in, via GitHub Releases

See the [wiki](https://agent-desktop.wiki) for the full feature list and configuration guides.

## Installation

### Prerequisites

- **OAuth**: an active Claude subscription + the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`), then run `claude login`
- **API key**: an Anthropic API key, configured in Settings > AI

### Linux

Download from the [Releases](https://github.com/BaLaurent/agent-desktop/releases) page.

```bash
# AppImage
chmod +x Agent-Desktop-*.AppImage
./Agent-Desktop-*.AppImage

# Debian / Ubuntu
sudo dpkg -i agent-desktop_*.deb
```

### macOS (Apple Silicon)

Download the `.dmg` from [Releases](https://github.com/BaLaurent/agent-desktop/releases), drag to Applications, then right-click → **Open** on first launch (unsigned app).

### Windows

Download from [Releases](https://github.com/BaLaurent/agent-desktop/releases) — NSIS installer or portable `.exe`.

## Development

```bash
git clone https://github.com/BaLaurent/agent-desktop.git
cd agent-desktop
npm install          # also requires Deno >= 2.9 on PATH (the `deno desktop` shell)
npm run dev          # deno desktop --hmr + Vite renderer watcher
```

```bash
npm run build        # build the renderer (output: out/renderer)
npm run dist:linux   # AppImage
npm run dist:mac     # .app bundle (x86_64 + arm64)
npm run dist:win     # .msi
npm test             # main + renderer
```

Architecture, IPC patterns, theming, headless deployment, and contribution guides → [wiki](https://agent-desktop.wiki).

## License

[AGPL-3.0](LICENSE)
