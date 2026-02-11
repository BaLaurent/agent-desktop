import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

/** Check if running inside an AppImage */
export function isAppImage(): boolean {
  return !!process.env.APPIMAGE
}

/**
 * Find a binary by name in PATH using pure Node.js (no `which` spawn).
 * Returns the absolute path if found and executable, null otherwise.
 */
export function findBinaryInPath(name: string): string | null {
  if (path.isAbsolute(name)) {
    try {
      fs.accessSync(name, fs.constants.X_OK)
      return name
    } catch {
      return null
    }
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of pathDirs) {
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // not here, try next
    }
  }
  return null
}

/**
 * Enrich process.env for AppImage and non-standard environments.
 * Additive only — never overwrites existing values.
 * Call once at startup, before app.whenReady().
 */
export function enrichEnvironment(): void {
  const home = os.homedir()

  // Ensure HOME is set (some AppImage environments strip it)
  if (!process.env.HOME) {
    process.env.HOME = home
    console.log('[env] Set HOME =', home)
  }

  // Ensure CLAUDE_CONFIG_DIR is set so the SDK finds credentials
  if (!process.env.CLAUDE_CONFIG_DIR) {
    process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude')
    console.log('[env] Set CLAUDE_CONFIG_DIR =', process.env.CLAUDE_CONFIG_DIR)
  }

  // Append common binary locations to PATH if they exist and aren't already included
  const extraDirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
    '/snap/bin',
    '/usr/bin',
    '/bin',
  ]

  const currentPath = process.env.PATH || ''
  const currentDirs = new Set(currentPath.split(path.delimiter).filter(Boolean))
  const added: string[] = []

  for (const dir of extraDirs) {
    if (!currentDirs.has(dir)) {
      try {
        fs.accessSync(dir, fs.constants.R_OK)
        added.push(dir)
        currentDirs.add(dir)
      } catch {
        // directory doesn't exist, skip
      }
    }
  }

  if (added.length > 0) {
    process.env.PATH = currentPath + path.delimiter + added.join(path.delimiter)
    console.log('[env] Appended to PATH:', added.join(', '))
  }

  // AppImage cleanup: remove bundled library paths so child processes
  // (claude CLI, whisper, etc.) don't load incompatible Electron .so files.
  // The current process's dynamic linker is already resolved, so this only
  // affects child processes spawned via child_process.spawn().
  if (isAppImage()) {
    console.log('[env] Running inside AppImage:', process.env.APPIMAGE)
    sanitizeAppImageEnv()
  }
}

/**
 * Remove AppImage-injected paths from LD_LIBRARY_PATH.
 * AppImage prepends paths like /tmp/.mount_AgentXXX/usr/lib which contain
 * Electron's bundled .so files — these break external binaries (claude CLI, whisper).
 */
function sanitizeAppImageEnv(): void {
  const appDir = process.env.APPDIR || ''

  // Clean LD_LIBRARY_PATH
  const ldPath = process.env.LD_LIBRARY_PATH
  if (ldPath) {
    const original = ldPath
    const cleaned = ldPath
      .split(':')
      .filter(p => {
        if (!p) return false
        // Remove paths inside the AppImage mount
        if (appDir && p.startsWith(appDir)) return false
        // Remove /tmp/.mount_* paths (AppImage runtime mount points)
        if (p.match(/^\/tmp\/\.mount_[^/]+/)) return false
        return true
      })
      .join(':')

    if (cleaned !== original) {
      // Save original for debugging, then set cleaned version
      process.env.LD_LIBRARY_PATH_APPIMAGE = original
      process.env.LD_LIBRARY_PATH = cleaned || undefined
      console.log('[env] Cleaned LD_LIBRARY_PATH for child processes')
      console.log('[env]   Original:', original)
      console.log('[env]   Cleaned:', cleaned || '(empty)')
    }
  }

  // Clean LD_PRELOAD if set by AppImage
  const ldPreload = process.env.LD_PRELOAD
  if (ldPreload && appDir && ldPreload.includes(appDir)) {
    const original = ldPreload
    const cleaned = ldPreload
      .split(':')
      .filter(p => p && !p.startsWith(appDir) && !p.match(/^\/tmp\/\.mount_[^/]+/))
      .join(':')

    if (cleaned !== original) {
      process.env.LD_PRELOAD_APPIMAGE = original
      process.env.LD_PRELOAD = cleaned || undefined
      console.log('[env] Cleaned LD_PRELOAD for child processes')
    }
  }
}
