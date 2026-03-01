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
const MAX_DEPTH = 10
const MAX_FILES = 1000

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
  const fileCount = { value: 0 }

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth >= MAX_DEPTH || fileCount.value >= MAX_FILES) return
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    const textFiles: string[] = []
    const subdirs: string[] = []

    for (const entry of entries) {
      if (fileCount.value >= MAX_FILES) break
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        subdirs.push(fullPath)
      } else if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        textFiles.push(fullPath)
      }
    }

    // Batch stat calls for text files
    const statResults = await Promise.all(
      textFiles.map(async (fullPath) => {
        try {
          const stat = await fsp.stat(fullPath)
          return { path: fullPath, name: relative(dirPath, fullPath), size: stat.size }
        } catch {
          return null
        }
      })
    )
    for (const r of statResults) {
      if (r && fileCount.value < MAX_FILES) {
        results.push(r)
        fileCount.value++
      }
    }

    // Recurse into subdirectories
    for (const subdir of subdirs) {
      if (fileCount.value >= MAX_FILES) break
      await scan(subdir, depth + 1)
    }
  }

  await scan(dirPath, 0)
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
    const dirEntries = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))
    const collections = await Promise.all(
      dirEntries.map(entry => scanCollection(join(KNOWLEDGES_DIR, entry.name), entry.name))
    )
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
