import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { PIExtensionInfo } from '../../shared/constants'
import { loadPISdk } from './piSdk'

export async function discoverPIExtensions(extensionsDir?: string): Promise<PIExtensionInfo[]> {
  const pi = await loadPISdk()

  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    ...(extensionsDir ? { additionalExtensionPaths: [extensionsDir] } : {}),
  })

  await resourceLoader.reload()

  const { extensions } = resourceLoader.getExtensions()
  return extensions.map((ext: { name: string; resolvedPath: string }) => ({
    name: ext.name,
    path: ext.resolvedPath,
  }))
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('pi:listExtensions', async () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'pi_extensionsDir'")
      .get() as { value: string } | undefined
    const extensionsDir = row?.value || undefined
    return discoverPIExtensions(extensionsDir)
  })
}
