import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { promises as fsp } from 'fs'
import { join, extname, dirname, basename } from 'path'
import os from 'os'
import { shell } from 'electron'
import type { FileNode } from '../../shared/types'
import { validateString, validatePathSafe } from '../utils/validate'
import { expandTilde } from '../utils/paths'
import { IMAGE_EXTS, getImageMime, mimeToExt } from '../utils/mime'

export { mimeToExt } from '../utils/mime'

const MAX_DEPTH = 10
const MAX_FILES = 500
const MAX_PASTE_SIZE = 5_000_000 // 5MB — clipboard paste limit
const MAX_PREVIEW_SIZE = 10 * 1024 * 1024 // 10MB — hard limit for file preview
const BINARY_MODEL_EXTS = new Set(['stl', '3mf', 'ply'])

export function classifyFileExt(ext: string): string | null {
  switch (ext) {
    case 'html': case 'htm': return 'html'
    case 'svg': return 'svg'
    case 'css': return 'css'
    case 'js': case 'jsx': return 'javascript'
    case 'ts': case 'tsx': return 'typescript'
    case 'json': return 'json'
    case 'md': case 'markdown': return 'markdown'
    case 'py': return 'python'
    case 'rs': return 'rust'
    case 'go': return 'go'
    case 'sh': case 'bash': return 'bash'
    case 'yml': case 'yaml': return 'yaml'
    case 'toml': return 'toml'
    case 'sql': return 'sql'
    case 'xml': return 'xml'
    case 'scad': return 'scad'
    default: return ext || null
  }
}

// Recursive tree (used by @mention autocomplete) — budget-limited
async function listTree(basePath: string, depth = 0, fileCount = { value: 0 }, excludeSet: Set<string> = new Set(['node_modules'])): Promise<FileNode[]> {
  if (depth >= MAX_DEPTH || fileCount.value >= MAX_FILES) return []

  let entries: string[]
  try {
    entries = await fsp.readdir(basePath)
  } catch {
    return []
  }

  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (fileCount.value >= MAX_FILES) break
    if (entry.startsWith('.') || excludeSet.has(entry)) continue

    const fullPath = join(basePath, entry)
    let stat: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stat = await fsp.stat(fullPath)
    } catch {
      continue
    }

    fileCount.value++

    if (stat.isDirectory()) {
      const children = await listTree(fullPath, depth + 1, fileCount, excludeSet)
      nodes.push({ name: entry, path: fullPath, isDirectory: true, children })
    } else {
      nodes.push({ name: entry, path: fullPath, isDirectory: false })
    }
  }

  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })

  return nodes
}

// Flat single-level listing (used by file explorer lazy loading)
// No recursion, no budget, no skip list — only hides hidden files (. prefix)
async function listDir(basePath: string): Promise<FileNode[]> {
  let entries: string[]
  try {
    entries = await fsp.readdir(basePath)
  } catch {
    return []
  }

  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (entry.startsWith('.')) continue

    const fullPath = join(basePath, entry)
    let stat: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stat = await fsp.stat(fullPath)
    } catch {
      continue
    }

    nodes.push({ name: entry, path: fullPath, isDirectory: stat.isDirectory() })
  }

  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })

  return nodes
}

async function generateCopyPath(originalPath: string): Promise<string> {
  const stat = await fsp.stat(originalPath)
  const dir = dirname(originalPath)
  let base: string
  let ext: string
  if (stat.isDirectory()) {
    base = basename(originalPath)
    ext = ''
  } else {
    ext = extname(originalPath)
    base = basename(originalPath, ext)
  }

  let candidate = join(dir, `${base} (copy)${ext}`)
  for (let i = 2; i <= 100; i++) {
    try {
      await fsp.access(candidate)
      candidate = join(dir, `${base} (copy ${i})${ext}`)
    } catch {
      return candidate
    }
  }
  throw new Error('Could not generate unique copy name')
}

export async function cleanupPastedFiles(): Promise<void> {
  const tmpDir = join(os.tmpdir(), 'agent-paste')
  try {
    const files = await fsp.readdir(tmpDir)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000 // 24h
    for (const file of files) {
      const filePath = join(tmpDir, file)
      try {
        const stats = await fsp.stat(filePath)
        if (stats.mtimeMs < cutoff) await fsp.unlink(filePath)
      } catch { /* ignore per-file errors */ }
    }
  } catch { /* dir may not exist yet */ }
}

export function registerHandlers(ipcMain: IpcMain, _db: Database.Database): void {
  ipcMain.handle('files:listTree', async (_event, basePath: string, excludePatterns?: string[]) => {
    validateString(basePath, 'basePath')
    const resolved = expandTilde(basePath)
    validatePathSafe(resolved)
    const excludeSet = new Set(Array.isArray(excludePatterns) ? excludePatterns : ['node_modules'])
    return listTree(resolved, 0, { value: 0 }, excludeSet)
  })

  ipcMain.handle('files:listDir', async (_event, basePath: string) => {
    validateString(basePath, 'basePath')
    const resolved = expandTilde(basePath)
    validatePathSafe(resolved)
    return listDir(resolved)
  })

  ipcMain.handle('files:readFile', async (_event, filePath: string) => {
    validateString(filePath, 'filePath')
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)

    const ext = extname(resolved).slice(1).toLowerCase()
    const stat = await fsp.stat(resolved)
    if (stat.size > MAX_PREVIEW_SIZE) {
      throw new Error(`File too large to preview (${(stat.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_PREVIEW_SIZE / 1024 / 1024}MB)`)
    }

    // Images: read as binary → base64 data URL
    if (IMAGE_EXTS.has(ext)) {
      const buffer = await fsp.readFile(resolved)
      const dataUrl = `data:${getImageMime(ext)};base64,${buffer.toString('base64')}`
      return { content: dataUrl, language: 'image' as const }
    }

    // Binary 3D model files: read as binary → base64
    if (BINARY_MODEL_EXTS.has(ext)) {
      const buffer = await fsp.readFile(resolved)
      return { content: buffer.toString('base64'), language: 'model' as const }
    }

    // Text files
    const content = await fsp.readFile(resolved, 'utf-8')
    const language = classifyFileExt(ext)

    return { content, language }
  })

  ipcMain.handle('files:revealInFileManager', async (_event, filePath: string) => {
    validateString(filePath, 'filePath')
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)
    shell.showItemInFolder(resolved)
  })

  ipcMain.handle('files:openWithDefault', async (_event, filePath: string) => {
    validateString(filePath, 'filePath')
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)
    const result = await shell.openPath(resolved)
    if (result) throw new Error(result)
  })

  ipcMain.handle('files:trash', async (_event, filePath: string) => {
    validateString(filePath, 'filePath')
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)
    await shell.trashItem(resolved)
  })

  ipcMain.handle('files:rename', async (_event, filePath: string, newName: string) => {
    validateString(filePath, 'filePath')
    validateString(newName, 'newName')
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)
    if (newName.includes('/') || newName.includes('\\') || newName.includes('\0')) {
      throw new Error('Invalid file name')
    }
    const newPath = join(dirname(resolved), newName)
    validatePathSafe(newPath)
    await fsp.rename(resolved, newPath)
    return newPath
  })

  ipcMain.handle('files:duplicate', async (_event, filePath: string) => {
    validateString(filePath, 'filePath')
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)
    const copyPath = await generateCopyPath(resolved)
    await fsp.cp(resolved, copyPath, { recursive: true })
    return copyPath
  })

  ipcMain.handle('files:writeFile', async (_event, filePath: string, content: string) => {
    validateString(filePath, 'filePath')
    validateString(content, 'content', 2_000_000)
    const resolved = expandTilde(filePath)
    validatePathSafe(resolved)
    const stat = await fsp.stat(resolved)
    if (stat.isDirectory()) throw new Error('Cannot write to a directory')
    await fsp.writeFile(resolved, content, 'utf-8')
  })

  ipcMain.handle('files:move', async (_event, sourcePath: string, destDir: string) => {
    validateString(sourcePath, 'sourcePath')
    validateString(destDir, 'destDir')
    const resolvedSource = expandTilde(sourcePath)
    const resolvedDest = expandTilde(destDir)
    validatePathSafe(resolvedSource)
    validatePathSafe(resolvedDest)

    // Dest must be an existing directory
    const destStat = await fsp.stat(resolvedDest)
    if (!destStat.isDirectory()) throw new Error('Destination is not a directory')

    // No-op if already in that directory
    if (dirname(resolvedSource) === resolvedDest) throw new Error('Source is already in the destination directory')

    // Prevent moving a folder into itself or its own children
    const sourceStat = await fsp.stat(resolvedSource)
    if (sourceStat.isDirectory() && (resolvedDest === resolvedSource || resolvedDest.startsWith(resolvedSource + '/'))) {
      throw new Error('Cannot move a folder into itself or its own children')
    }

    // Compute target path, auto-rename on conflict
    const name = basename(resolvedSource)
    const ext = sourceStat.isDirectory() ? '' : extname(name)
    const base = sourceStat.isDirectory() ? name : basename(name, ext)
    let target = join(resolvedDest, name)

    try {
      await fsp.access(target)
      // Conflict — find unique name
      for (let i = 1; i <= 100; i++) {
        const candidate = join(resolvedDest, `${base} (${i})${ext}`)
        try {
          await fsp.access(candidate)
        } catch {
          target = candidate
          break
        }
        if (i === 100) throw new Error('Could not generate unique name for move')
      }
    } catch (err: any) {
      if (err.message?.includes('Could not generate')) throw err
      // target doesn't exist — good, use it as-is
    }

    // Try rename (same filesystem), fall back to cp+rm (cross-filesystem)
    try {
      await fsp.rename(resolvedSource, target)
    } catch (renameErr: any) {
      if (renameErr.code === 'EXDEV') {
        await fsp.cp(resolvedSource, target, { recursive: true })
        await fsp.rm(resolvedSource, { recursive: true, force: true })
      } else {
        throw renameErr
      }
    }

    return target
  })

  ipcMain.handle('files:createFile', async (_event, dirPath: string, name: string) => {
    validateString(dirPath, 'dirPath')
    validateString(name, 'name')
    const resolvedDir = expandTilde(dirPath)
    validatePathSafe(resolvedDir)
    if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
      throw new Error('Invalid file name')
    }
    const target = join(resolvedDir, name)
    validatePathSafe(target)
    try {
      const handle = await fsp.open(target, 'wx') // O_CREAT | O_EXCL — atomic
      await handle.close()
    } catch (err: any) {
      if (err.code === 'EEXIST') throw new Error('A file or folder with that name already exists')
      throw err
    }
    return target
  })

  ipcMain.handle('files:createFolder', async (_event, dirPath: string, name: string) => {
    validateString(dirPath, 'dirPath')
    validateString(name, 'name')
    const resolvedDir = expandTilde(dirPath)
    validatePathSafe(resolvedDir)
    if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
      throw new Error('Invalid folder name')
    }
    const target = join(resolvedDir, name)
    validatePathSafe(target)
    try {
      await fsp.mkdir(target) // throws EEXIST if exists
    } catch (err: any) {
      if (err.code === 'EEXIST') throw new Error('A file or folder with that name already exists')
      throw err
    }
    return target
  })

  ipcMain.handle('files:savePastedFile', async (_event, data: Uint8Array, mimeType: string) => {
    if (!(data instanceof Uint8Array) || data.length === 0) throw new Error('Invalid file data')
    if (typeof mimeType !== 'string') throw new Error('Invalid MIME type')
    if (data.length > MAX_PASTE_SIZE) throw new Error('Pasted file too large')

    const ext = mimeToExt(mimeType) || 'bin'
    const filename = `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const tmpDir = join(os.tmpdir(), 'agent-paste')
    await fsp.mkdir(tmpDir, { recursive: true })
    const tmpPath = join(tmpDir, filename)
    await fsp.writeFile(tmpPath, Buffer.from(data))
    return tmpPath
  })
}
