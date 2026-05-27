import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { getSetting } from '../utils/db'
import { promises as fsp } from 'fs'
import { join, extname, dirname, basename } from 'path'
import os from 'os'
import { spawn } from 'child_process'
import { expandTilde } from '../utils/paths'
import { validateString, validatePositiveInt, validatePathSafe, checkReadAllowed, checkWriteAllowed, validatePathSafeAsync } from '../utils/validate'
import { isChildPath } from '../../shared/pathUtils'
import { findBinaryInPath } from '../utils/env'

// ─── Constants ──────────────────────────────────────────────

const MAX_DEPTH = 10
const MAX_FILES = 500
const MAX_PASTE_SIZE = 5_000_000 // 5MB
const MAX_PREVIEW_SIZE = 10 * 1024 * 1024 // 10MB

const BINARY_MODEL_EXTS = new Set(['stl', '3mf', 'ply'])

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tiff', 'tif',
])

// Audit S5-3 (2026-04-28): allowlist of known-safe terminal binaries resolved from
// process.env.TERMINAL. Basenames are matched so full-path entries (e.g. /usr/bin/kitty) work.
// If TERMINAL is unset or points to a binary not on this list we fall back to 'xterm'.
const KNOWN_TERMINALS: ReadonlySet<string> = new Set([
  'xterm', 'konsole', 'gnome-terminal', 'alacritty', 'kitty', 'wezterm',
  'foot', 'tilix', 'terminator', 'urxvt', 'rxvt', 'st',
  'xfce4-terminal', 'lxterminal', 'mate-terminal', 'xdg-terminal-exec',
])

function getImageMime(ext: string): string {
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'ico': return 'image/x-icon'
    case 'avif': return 'image/avif'
    case 'tiff': case 'tif': return 'image/tiff'
    default: return 'application/octet-stream'
  }
}

function mimeToExt(mime: string): string | null {
  switch (mime) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    case 'image/bmp': return 'bmp'
    case 'image/svg+xml': return 'svg'
    case 'image/avif': return 'avif'
    default: return null
  }
}

function classifyFileExt(ext: string): string | null {
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

// ─── File operations ────────────────────────────────────────

interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
}

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

async function listDir(basePath: string): Promise<FileNode[]> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fsp.readdir(basePath, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(basePath, entry.name)

    let isDir = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      try {
        const stat = await fsp.stat(fullPath)
        isDir = stat.isDirectory()
      } catch {
        isDir = false
      }
    }

    nodes.push({ name: entry.name, path: fullPath, isDirectory: isDir })
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

// ─── Handler registration ───────────────────────────────────

/** Read the global hooks_cwdWhitelist setting from the database. */
function getGlobalWhitelist(db: SqlJsAdapter): Array<{ path: string; access: 'read' | 'readwrite' }> {
  try {
    const value = getSetting(db as any, 'hooks_cwdWhitelist')
    if (!value) return []
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export interface FilesHandlerOptions {
  sessionsBase: string
}

export function registerFilesHandlers(
  registrar: HandleRegistrar,
  db: SqlJsAdapter,
  options: FilesHandlerOptions,
): void {
  registrar.handle('files:listTree', async (_event, basePath: unknown, excludePatterns?: unknown) => {
    const bp = validateString(basePath, 'basePath')
    const resolved = expandTilde(bp)
    validatePathSafe(resolved)
    const realResolved = await validatePathSafeAsync(resolved)
    const whitelist = getGlobalWhitelist(db)
    const outside = checkReadAllowed(realResolved, whitelist)
    if (outside) throw new Error(`Access denied: ${outside} is outside the allowed read directories`)
    const excludeSet = new Set(Array.isArray(excludePatterns) ? excludePatterns as string[] : ['node_modules'])
    return listTree(realResolved, 0, { value: 0 }, excludeSet)
  })

  registrar.handle('files:listDir', async (_event, basePath: unknown) => {
    const bp = validateString(basePath, 'basePath')
    const resolved = expandTilde(bp)
    validatePathSafe(resolved)
    const realResolved = await validatePathSafeAsync(resolved)
    const whitelist = getGlobalWhitelist(db)
    const outside = checkReadAllowed(realResolved, whitelist)
    if (outside) throw new Error(`Access denied: ${outside} is outside the allowed read directories`)
    return listDir(realResolved)
  })

  registrar.handle('files:readFile', async (_event, filePath: unknown) => {
    const fp = validateString(filePath, 'filePath')
    const resolved = expandTilde(fp)
    validatePathSafe(resolved)
    const realResolved = await validatePathSafeAsync(resolved)
    const whitelist = getGlobalWhitelist(db)
    const outside = checkReadAllowed(realResolved, whitelist)
    if (outside) throw new Error(`Access denied: ${outside} is outside the allowed read directories`)

    const ext = extname(realResolved).slice(1).toLowerCase()
    const stat = await fsp.stat(realResolved)
    if (stat.size > MAX_PREVIEW_SIZE) {
      throw new Error(`File too large to preview (${(stat.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_PREVIEW_SIZE / 1024 / 1024}MB)`)
    }

    if (IMAGE_EXTS.has(ext)) {
      const buffer = await fsp.readFile(realResolved)
      const dataUrl = `data:${getImageMime(ext)};base64,${buffer.toString('base64')}`
      return { content: dataUrl, language: 'image' as const }
    }

    if (BINARY_MODEL_EXTS.has(ext)) {
      const buffer = await fsp.readFile(realResolved)
      return { content: buffer.toString('base64'), language: 'model' as const }
    }

    const content = await fsp.readFile(realResolved, 'utf-8')
    const language = classifyFileExt(ext)
    return { content, language }
  })

  registrar.handle('files:rename', async (_event, filePath: unknown, newName: unknown) => {
    const fp = validateString(filePath, 'filePath')
    const nn = validateString(newName, 'newName')
    const resolved = expandTilde(fp)
    validatePathSafe(resolved)
    if (nn.includes('/') || nn.includes('\\') || nn.includes('\0')) {
      throw new Error('Invalid file name')
    }
    const newPath = join(dirname(resolved), nn)
    validatePathSafe(newPath)
    const realResolved = await validatePathSafeAsync(resolved)
    const realNewPath = await validatePathSafeAsync(newPath)
    const whitelist = getGlobalWhitelist(db)
    const outsideSource = checkWriteAllowed(realResolved, whitelist)
    if (outsideSource) throw new Error(`Write access denied: ${outsideSource} is outside the allowed readwrite directories`)
    const outsideDest = checkWriteAllowed(realNewPath, whitelist)
    if (outsideDest) throw new Error(`Write access denied: ${outsideDest} is outside the allowed readwrite directories`)
    await fsp.rename(resolved, newPath)
    return newPath
  })

  registrar.handle('files:duplicate', async (_event, filePath: unknown) => {
    const fp = validateString(filePath, 'filePath')
    const resolved = expandTilde(fp)
    validatePathSafe(resolved)
    const realResolved = await validatePathSafeAsync(resolved)
    const whitelist = getGlobalWhitelist(db)
    const outsideWrite = checkWriteAllowed(realResolved, whitelist)
    if (outsideWrite) throw new Error(`Write access denied: ${outsideWrite} is outside the allowed readwrite directories`)
    const copyPath = await generateCopyPath(realResolved)
    await fsp.cp(realResolved, copyPath, { recursive: true })
    return copyPath
  })

  registrar.handle('files:writeFile', async (_event, filePath: unknown, content: unknown) => {
    const fp = validateString(filePath, 'filePath')
    const c = validateString(content, 'content', 2_000_000)
    const resolved = expandTilde(fp)
    validatePathSafe(resolved)
    const realResolved = await validatePathSafeAsync(resolved)
    const whitelist = getGlobalWhitelist(db)
    const outsideWrite = checkWriteAllowed(realResolved, whitelist)
    if (outsideWrite) throw new Error(`Write access denied: ${outsideWrite} is outside the allowed readwrite directories`)
    const stat = await fsp.stat(realResolved)
    if (stat.isDirectory()) throw new Error('Cannot write to a directory')
    await fsp.writeFile(realResolved, c, 'utf-8')
  })

  registrar.handle('files:move', async (_event, sourcePath: unknown, destDir: unknown) => {
    const sp = validateString(sourcePath, 'sourcePath')
    const dd = validateString(destDir, 'destDir')
    const resolvedSource = expandTilde(sp)
    const resolvedDest = expandTilde(dd)
    validatePathSafe(resolvedSource)
    validatePathSafe(resolvedDest)
    const realSource = await validatePathSafeAsync(resolvedSource)
    const realDest = await validatePathSafeAsync(resolvedDest)
    const whitelist = getGlobalWhitelist(db)
    const outsideSource = checkWriteAllowed(realSource, whitelist)
    if (outsideSource) throw new Error(`Write access denied: ${outsideSource} is outside the allowed readwrite directories`)
    const outsideDest = checkWriteAllowed(realDest, whitelist)
    if (outsideDest) throw new Error(`Write access denied: ${outsideDest} is outside the allowed readwrite directories`)

    const destStat = await fsp.stat(resolvedDest)
    if (!destStat.isDirectory()) throw new Error('Destination is not a directory')

    if (dirname(resolvedSource) === resolvedDest) throw new Error('Source is already in the destination directory')

    const sourceStat = await fsp.stat(resolvedSource)
    if (sourceStat.isDirectory() && (resolvedDest === resolvedSource || isChildPath(resolvedSource, resolvedDest))) {
      throw new Error('Cannot move a folder into itself or its own children')
    }

    const name = basename(resolvedSource)
    const ext = sourceStat.isDirectory() ? '' : extname(name)
    const base = sourceStat.isDirectory() ? name : basename(name, ext)
    let target = join(resolvedDest, name)

    try {
      await fsp.access(target)
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
    }

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

  registrar.handle('files:createFile', async (_event, dirPath: unknown, name: unknown) => {
    const dp = validateString(dirPath, 'dirPath')
    const n = validateString(name, 'name')
    const resolvedDir = expandTilde(dp)
    validatePathSafe(resolvedDir)
    if (n.includes('/') || n.includes('\\') || n.includes('\0')) {
      throw new Error('Invalid file name')
    }
    const target = join(resolvedDir, n)
    validatePathSafe(target)
    const realTarget = await validatePathSafeAsync(target)
    const whitelist = getGlobalWhitelist(db)
    const outsideWrite = checkWriteAllowed(realTarget, whitelist)
    if (outsideWrite) throw new Error(`Write access denied: ${outsideWrite} is outside the allowed readwrite directories`)
    try {
      const handle = await fsp.open(target, 'wx')
      await handle.close()
    } catch (err: any) {
      if (err.code === 'EEXIST') throw new Error('A file or folder with that name already exists')
      throw err
    }
    return target
  })

  registrar.handle('files:createFolder', async (_event, dirPath: unknown, name: unknown) => {
    const dp = validateString(dirPath, 'dirPath')
    const n = validateString(name, 'name')
    const resolvedDir = expandTilde(dp)
    validatePathSafe(resolvedDir)
    if (n.includes('/') || n.includes('\\') || n.includes('\0')) {
      throw new Error('Invalid folder name')
    }
    const target = join(resolvedDir, n)
    validatePathSafe(target)
    const realTarget = await validatePathSafeAsync(target)
    const whitelist = getGlobalWhitelist(db)
    const outsideWrite = checkWriteAllowed(realTarget, whitelist)
    if (outsideWrite) throw new Error(`Write access denied: ${outsideWrite} is outside the allowed readwrite directories`)
    try {
      await fsp.mkdir(target)
    } catch (err: any) {
      if (err.code === 'EEXIST') throw new Error('A file or folder with that name already exists')
      throw err
    }
    return target
  })

  registrar.handle('files:savePastedFile', async (_event, data: unknown, mimeType: unknown) => {
    if (!(data instanceof Uint8Array) || (data as Uint8Array).length === 0) throw new Error('Invalid file data')
    if (typeof mimeType !== 'string') throw new Error('Invalid MIME type')
    const buf = data as Uint8Array
    if (buf.length > MAX_PASTE_SIZE) throw new Error('Pasted file too large')

    const ext = mimeToExt(mimeType) || 'bin'
    const filename = `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const tmpDir = join(os.tmpdir(), 'agent-paste')
    await fsp.mkdir(tmpDir, { recursive: true })
    const tmpPath = join(tmpDir, filename)
    await fsp.writeFile(tmpPath, Buffer.from(buf))
    return tmpPath
  })

  registrar.handle('files:openTerminalHere', async (_event, filePath: unknown) => {
    // Audit S5-3 (2026-04-28): path gated via validatePathSafe + validatePathSafeAsync
    // (symlink resolution), checkReadAllowed for whitelist parity with other read handlers.
    // spawn uses argv array (no shell interpolation). $TERMINAL is validated against
    // KNOWN_TERMINALS by basename; if absent or not allowlisted, we walk a fallback
    // chain of common terminals and pick the first one actually installed in PATH.
    const fp = validateString(filePath, 'filePath')
    const resolved = expandTilde(fp)
    validatePathSafe(resolved)
    const realResolved = await validatePathSafeAsync(resolved)
    const stats = await fsp.stat(realResolved)
    const dir = stats.isDirectory() ? realResolved : dirname(realResolved)
    const whitelist = getGlobalWhitelist(db)
    const outside = checkReadAllowed(dir, whitelist)
    if (outside) throw new Error(`Access denied: ${outside} is outside the allowed read directories`)

    // Build candidate chain: env TERMINAL first (allowlisted), then common installed emulators.
    const envTerm = process.env.TERMINAL ?? ''
    const envBasename = basename(envTerm)
    const candidates: string[] = []
    if (envTerm && KNOWN_TERMINALS.has(envBasename)) candidates.push(envTerm)
    for (const t of [
      'alacritty', 'kitty', 'wezterm', 'foot', 'gnome-terminal', 'konsole',
      'xfce4-terminal', 'tilix', 'terminator', 'mate-terminal', 'lxterminal',
      'urxvt', 'rxvt', 'st', 'xterm',
    ]) {
      if (!candidates.includes(t)) candidates.push(t)
    }

    // Per-terminal cwd argument convention. Most respect the spawn `cwd` directly;
    // gnome-terminal / xfce4-terminal need an explicit flag. xdg-terminal-exec is
    // a thin wrapper that itself reads $TERMINAL — we just rely on cwd.
    function argsFor(termName: string): string[] {
      const b = basename(termName)
      if (b === 'gnome-terminal' || b === 'xfce4-terminal' || b === 'mate-terminal') {
        return [`--working-directory=${dir}`]
      }
      return []
    }

    // findBinaryInPath weeds out absent emulators so we only spawn an installed one.
    // (Truly broken binaries — present but unrunnable — would still spawn-and-die
    // silently, same as before, since stdio is 'ignore'.)
    let lastErr: unknown = null
    for (const term of candidates) {
      const bin = term.includes('/') ? term : findBinaryInPath(term)
      if (!bin) continue
      try {
        spawn(bin, argsFor(term), { cwd: dir, detached: true, stdio: 'ignore' }).unref()
        return
      } catch (err) {
        lastErr = err
      }
    }
    throw new Error(
      `No working terminal emulator found. Set $TERMINAL to one of: ${[...KNOWN_TERMINALS].join(', ')}. ` +
      `Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
    )
  })

  registrar.handle('files:prepareSession', async (
    _event,
    conversationId: unknown,
    sourcePaths: unknown,
    method: unknown,
    renames?: unknown
  ) => {
    const cid = validatePositiveInt(conversationId, 'conversationId')
    if (!Array.isArray(sourcePaths) || (sourcePaths as unknown[]).length === 0) throw new Error('sourcePaths required')
    const paths = sourcePaths as string[]
    if (paths.length > 200) throw new Error('Too many files (max 200)')
    if (method !== 'copy' && method !== 'symlink') throw new Error('method must be copy or symlink')

    const renamesMap = renames as Record<string, string> | undefined
    if (renamesMap != null) {
      if (typeof renamesMap !== 'object' || Array.isArray(renamesMap)) throw new Error('renames must be a plain object')
      for (const [, newName] of Object.entries(renamesMap)) {
        if (typeof newName !== 'string' || newName.trim() === '') throw new Error('Rename value must be a non-empty string')
        if (newName.includes('/') || newName.includes('\\') || newName.includes('\0')) throw new Error('Rename value contains invalid characters')
      }
    }

    const destDir = join(options.sessionsBase, String(cid))
    await fsp.mkdir(destDir, { recursive: true })
    // Gate the session destination directory for write access
    const realDestDir = await validatePathSafeAsync(destDir)
    const whitelist = getGlobalWhitelist(db)
    const outsideWrite = checkWriteAllowed(realDestDir, whitelist)
    if (outsideWrite) throw new Error(`Write access denied: ${outsideWrite} is outside the allowed readwrite directories`)

    const items: { resolvedSrc: string; dest: string }[] = []
    const assignedDests = new Set<string>()
    for (const src of paths) {
      validateString(src, 'sourcePath', 2000)
      const resolvedSrc = expandTilde(src)
      validatePathSafe(resolvedSrc)
      // Defeat symlink bypass on source paths (reading from them)
      await validatePathSafeAsync(resolvedSrc)

      const name = (renamesMap && renamesMap[src]) ? renamesMap[src].trim() : basename(resolvedSrc)
      let dest = join(destDir, name)

      const existsOnDiskOrAssigned = async (p: string) =>
        assignedDests.has(p) || await fsp.access(p).then(() => true, () => false)

      if (await existsOnDiskOrAssigned(dest)) {
        const ext = extname(name)
        const base = basename(name, ext)
        for (let i = 1; i < 1000; i++) {
          dest = join(destDir, `${base}_${i}${ext}`)
          if (!await existsOnDiskOrAssigned(dest)) break
        }
      }

      assignedDests.add(dest)
      items.push({ resolvedSrc, dest })
    }

    const BATCH_SIZE = 16
    let count = 0
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map(async ({ resolvedSrc, dest }) => {
        if (method === 'copy') {
          const stat = await fsp.stat(resolvedSrc)
          if (stat.isDirectory()) {
            await fsp.cp(resolvedSrc, dest, { recursive: true })
          } else {
            await fsp.copyFile(resolvedSrc, dest)
          }
        } else {
          await fsp.symlink(resolvedSrc, dest)
        }
        count++
      }))
    }

    return { cwd: destDir, count }
  })
}
