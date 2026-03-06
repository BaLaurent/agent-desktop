import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import * as path from 'path'
import type { PIExtensionInfo } from '../../shared/constants'
import type { SlashCommand } from '../../shared/types'
import type { PiUIResponse } from '../../shared/piUITypes'
import { loadPISdk } from './piSdk'

/** Extension shape returned by DefaultResourceLoader.getExtensions() */
interface PIExtension {
  path: string
  resolvedPath: string
  commands: Map<string, { name: string; description?: string }>
}

async function loadExtensions(extensionsDir?: string): Promise<{ extensions: PIExtension[]; errors: unknown[] }> {
  const pi = await loadPISdk()

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    ...(extensionsDir ? { additionalExtensionPaths: [extensionsDir] } : {}),
  })

  await resourceLoader.reload()
  return resourceLoader.getExtensions() as { extensions: PIExtension[]; errors: unknown[] }
}

/** Derive a human-readable name from extension path (filename without extension) */
function extensionName(ext: PIExtension): string {
  return path.basename(ext.resolvedPath).replace(/\.[^.]+$/, '')
}

export async function discoverPIExtensions(extensionsDir?: string): Promise<PIExtensionInfo[]> {
  const { extensions } = await loadExtensions(extensionsDir)
  return extensions.map((ext) => ({
    name: extensionName(ext),
    path: ext.resolvedPath,
  }))
}

/**
 * Discover commands registered by Pi extensions.
 * Reads the already-parsed commands Map on each Extension object
 * (populated by DefaultResourceLoader after running factories).
 */
export async function discoverPIExtensionCommands(extensionsDir?: string): Promise<SlashCommand[]> {
  let extensions: PIExtension[]
  try {
    const result = await loadExtensions(extensionsDir)
    extensions = result.extensions
  } catch {
    return []
  }

  const commands: SlashCommand[] = []

  for (const ext of extensions) {
    if (!ext.commands || ext.commands.size === 0) continue
    for (const [, cmd] of ext.commands) {
      commands.push({
        name: cmd.name,
        description: cmd.description || `Extension: ${extensionName(ext)}`,
        source: 'extension',
      })
    }
  }

  return commands
}

// Registry of active PiUIContext instances (keyed by conversationId)
const activeContexts = new Map<number, { handleResponse: (r: PiUIResponse) => void }>()

export function registerPiUIContext(conversationId: number, ctx: { handleResponse: (r: PiUIResponse) => void }): void {
  activeContexts.set(conversationId, ctx)
}

export function unregisterPiUIContext(conversationId: number): void {
  activeContexts.delete(conversationId)
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('pi:listExtensions', async () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'pi_extensionsDir'")
      .get() as { value: string } | undefined
    const extensionsDir = row?.value || undefined
    return discoverPIExtensions(extensionsDir)
  })

  ipcMain.on('pi:uiResponse', (_event, response: PiUIResponse) => {
    for (const ctx of activeContexts.values()) {
      ctx.handleResponse(response)
    }
  })

  ipcMain.on('pi:tuiInput', (_event, payload: { id: string; data: string }) => {
    for (const ctx of activeContexts.values()) {
      (ctx as { handleTuiInput?: (id: string, data: string) => void }).handleTuiInput?.(payload.id, payload.data)
    }
  })
}
