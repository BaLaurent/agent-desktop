// PI (Oh My Pi) extension discovery — Electron main-process IPC surface.
//
// The former implementation loaded the in-process @mariozechner SDK's
// DefaultResourceLoader to enumerate extensions/commands and routed extension-UI
// responses to an in-process PiUIContext. Under the omp RPC backend, omp owns
// its own extensions/skills (~/.omp) inside the subprocess and gates tool
// approvals over its extension-UI channel (bridged in ompApprovalBridge.ts), so
// there is no in-process SDK to query and no PiUIContext to route to.
//
// omp-native extension/command enumeration over RPC (e.g. via get_available_commands)
// is deferred — see the project backlog. Until then discovery returns empty so
// the settings panel and command list render cleanly instead of crashing.

import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { PIExtensionInfo } from '../../shared/constants'
import type { SlashCommand } from '../../shared/types'

/** No in-process extension enumeration under the omp RPC backend (backlog). */
export async function discoverPIExtensions(_extensionsDir?: string): Promise<PIExtensionInfo[]> {
  return []
}

/** No extension-contributed slash commands under the omp RPC backend (backlog). */
export async function discoverPIExtensionCommands(_extensionsDir?: string): Promise<SlashCommand[]> {
  return []
}

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('pi:listExtensions', async () => discoverPIExtensions())
}
