import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { PIExtensionInfo } from '../../shared/constants'
import type { SlashCommand } from '../../shared/types'
import type { PiUIResponse } from '../../shared/piUITypes'
import { loadPISdk } from './piSdk'

async function loadExtensions(extensionsDir?: string) {
  const pi = await loadPISdk()

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    ...(extensionsDir ? { additionalExtensionPaths: [extensionsDir] } : {}),
  })

  await resourceLoader.reload()
  return resourceLoader.getExtensions()
}

export async function discoverPIExtensions(extensionsDir?: string): Promise<PIExtensionInfo[]> {
  const { extensions } = await loadExtensions(extensionsDir)
  return extensions.map((ext: { name: string; resolvedPath: string }) => ({
    name: ext.name,
    path: ext.resolvedPath,
  }))
}

/**
 * Discover commands registered by Pi extensions.
 * Runs each extension factory with a no-op Proxy API to capture registerCommand calls
 * without side effects.
 */
export async function discoverPIExtensionCommands(extensionsDir?: string): Promise<SlashCommand[]> {
  let extensions: { name: string; factory: (api: unknown) => void | Promise<void> }[]
  try {
    const result = await loadExtensions(extensionsDir)
    extensions = result.extensions
  } catch {
    return []
  }

  const commands: SlashCommand[] = []

  for (const ext of extensions) {
    const registered: { name: string; description: string }[] = []

    // Proxy that captures registerCommand and no-ops everything else
    function createNoopProxy(): unknown {
      return new Proxy(() => createNoopProxy(), {
        get: (_target, prop) => {
          if (prop === 'registerCommand') {
            return (name: string, opts?: { description?: string }) => {
              registered.push({ name, description: opts?.description || '' })
            }
          }
          return createNoopProxy()
        },
        apply: () => createNoopProxy(),
      })
    }

    try {
      await ext.factory(createNoopProxy())
    } catch {
      // Extension factory may fail with mock — that's OK
    }

    for (const cmd of registered) {
      commands.push({
        name: cmd.name,
        description: cmd.description || `Extension: ${ext.name}`,
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
}
