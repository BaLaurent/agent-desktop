import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { shell } from 'electron'
import { app } from 'electron'
import { join, extname, relative } from 'path'
import { promises as fsp } from 'fs'
import type { KnowledgeCollection } from '../../shared/types'
import { validateString } from '../utils/validate'
import { TEXT_EXTENSIONS } from '../utils/mime'

const KNOWLEDGES_DIR = join(app.getPath('home'), '.agent-desktop', 'knowledges')

export async function ensureKnowledgesDir(): Promise<void> {
  await fsp.mkdir(KNOWLEDGES_DIR, { recursive: true })
}

export function getKnowledgesDir(): string {
  return KNOWLEDGES_DIR
}

export function getSupportedExtensions(): Set<string> {
  return TEXT_EXTENSIONS
}

async function findSupportedFiles(dirPath: string): Promise<{ name: string; path: string; size: number }[]> {
  const results: { name: string; path: string; size: number }[] = []

  async function scan(dir: string): Promise<void> {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await scan(fullPath)
      } else if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        try {
          const stat = await fsp.stat(fullPath)
          results.push({ name: relative(dirPath, fullPath), path: fullPath, size: stat.size })
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await scan(dirPath)
  return results
}

async function scanCollection(collectionPath: string, collectionName: string): Promise<KnowledgeCollection> {
  const files = await findSupportedFiles(collectionPath)
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  return {
    name: collectionName,
    path: collectionPath,
    fileCount: files.length,
    totalSize,
  }
}

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('kb:listCollections', async () => {
    await ensureKnowledgesDir()
    const entries = await fsp.readdir(KNOWLEDGES_DIR, { withFileTypes: true })
    const collections: KnowledgeCollection[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const collectionPath = join(KNOWLEDGES_DIR, entry.name)
      collections.push(await scanCollection(collectionPath, entry.name))
    }
    return collections
  })

  ipcMain.handle('kb:getCollectionFiles', async (_e, collectionName: string) => {
    validateString(collectionName, 'collectionName', 500)
    // Prevent directory traversal
    if (collectionName.includes('..') || collectionName.includes('/') || collectionName.includes('\\')) {
      throw new Error('Invalid collection name')
    }
    const collectionPath = join(KNOWLEDGES_DIR, collectionName)
    return findSupportedFiles(collectionPath)
  })

  ipcMain.handle('kb:openKnowledgesFolder', async () => {
    await ensureKnowledgesDir()
    shell.showItemInFolder(KNOWLEDGES_DIR)
  })
}
