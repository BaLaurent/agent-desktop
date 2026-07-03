// PI (Oh My Pi) extension discovery — Electron main-process IPC surface.
//
// The former implementation loaded the in-process @mariozechner SDK's
// DefaultResourceLoader to enumerate extensions/commands. Under the omp RPC
// backend, omp owns its own extensions/skills (~/.omp + <cwd>/.omp) inside the
// subprocess, so we enumerate them over RPC via `get_available_commands`
// (see ompCommands.ts) rather than touching an in-process SDK.
//
// `discoverPIExtensions` surfaces omp's `extension`-sourced commands to the
// settings panel for visibility. Enforcement of the per-extension disable
// toggle (`pi_disabledExtensions`) IS now wired for agent turns: streamingOmp
// builds a per-run `omp --config` overlay whose `disabledExtensions` is the
// UNION of omp's effective list + the app's ids (see ompConfigOverlay.ts).
// Residual: bundled/command-named extensions whose omp `extension-module:<derivedName>`
// id (path-derived) differs from the command name are NOT reliably disable-able —
// omp does not expose that derived id over RPC. `skill:`/`mcp:`/`slash-command:`
// ids disable cleanly.

import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { PIExtensionInfo } from '../../shared/constants'
import type { SlashCommand } from '../../shared/types'
import { discoverOmpCommands } from '../../core/services/pi/ompCommands'

/**
 * Enumerate omp's extension-sourced commands as PI extensions. omp discovers
 * extensions from ~/.omp (user) and the process cwd's .omp (project). Best-effort:
 * returns [] if omp is unavailable. `path` mirrors `name` — omp does not expose a
 * filesystem path over RPC, and the settings panel only needs a stable key + label.
 */
export async function discoverPIExtensions(_extensionsDir?: string): Promise<PIExtensionInfo[]> {
  const commands = await discoverOmpCommands({ cwd: process.cwd() })
  return commands
    .filter((c) => c.source === 'extension')
    .map((c) => ({ name: c.name, path: c.name }))
}

/**
 * Extension-contributed slash commands. Under the omp backend these already flow
 * through `commands:list` (the pi branch calls `discoverOmpCommands` directly),
 * so this legacy hook — invoked only on the CLAUDE command path — returns [].
 */
export async function discoverPIExtensionCommands(_extensionsDir?: string): Promise<SlashCommand[]> {
  return []
}

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('pi:listExtensions', async () => discoverPIExtensions())
}
