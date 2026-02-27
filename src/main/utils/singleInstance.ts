import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'

/**
 * Read the main PID from Electron's SingletonLock symlink.
 * The symlink target is `{hostname}-{pid}`.
 * Returns null if the lock doesn't exist, hostname mismatches, or PID is invalid.
 */
function readLockPid(userDataPath: string): number | null {
  const lockPath = path.join(userDataPath, 'SingletonLock')
  try {
    const target = fs.readlinkSync(lockPath)
    const dashIdx = target.lastIndexOf('-')
    if (dashIdx === -1) return null

    const hostname = target.slice(0, dashIdx)
    if (hostname !== os.hostname()) return null

    const pid = parseInt(target.slice(dashIdx + 1), 10)
    if (!Number.isFinite(pid) || pid <= 0) return null

    return pid
  } catch {
    return null
  }
}

/**
 * Find child PIDs of a given parent by scanning /proc entries for PPid.
 */
function findChildPids(parentPid: number): number[] {
  const children: number[] = []
  try {
    const entries = fs.readdirSync('/proc')
    for (const entry of entries) {
      const pid = parseInt(entry, 10)
      if (!Number.isFinite(pid) || pid <= 0) continue

      try {
        const status = fs.readFileSync(path.join('/proc', entry, 'status'), 'utf8')
        const match = status.match(/^PPid:\s+(\d+)/m)
        if (match && parseInt(match[1], 10) === parentPid) {
          children.push(pid)
        }
      } catch {
        // process vanished between readdir and readFile — skip
      }
    }
  } catch {
    // /proc not readable — no children found
  }
  return children
}

/**
 * Check if a PID is still alive.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Kill existing Agent Desktop instances before acquiring the singleton lock.
 * Reads Electron's SingletonLock to find the stale main process, sends SIGTERM
 * (allows graceful DB flush), then SIGKILL survivors after 500ms.
 * Linux-only — call before requestSingleInstanceLock().
 */
export function killExistingInstances(): void {
  const userDataPath = app.getPath('userData')
  const mainPid = readLockPid(userDataPath)
  if (mainPid === null) return

  // Don't kill ourselves
  if (mainPid === process.pid) return

  // Verify the process actually exists
  if (!isAlive(mainPid)) return

  const childPids = findChildPids(mainPid)
  const allPids = [mainPid, ...childPids]
  let killed = 0

  // SIGTERM the main process first — lets before-quit handler flush DB
  try {
    process.kill(mainPid, 'SIGTERM')
  } catch {
    // ESRCH (already dead) or EPERM (wrong user) — skip
  }

  // Busy-poll for up to 500ms waiting for main to exit
  const deadline = Date.now() + 500
  while (isAlive(mainPid) && Date.now() < deadline) {
    // Spin ~10ms
    const spinEnd = Date.now() + 10
    while (Date.now() < spinEnd) { /* busy wait */ }
  }

  // SIGKILL any survivors
  for (const pid of allPids) {
    if (!isAlive(pid)) {
      killed++
      continue
    }
    try {
      process.kill(pid, 'SIGKILL')
      killed++
    } catch {
      // ESRCH or EPERM — skip
    }
  }

  if (killed > 0) {
    console.log(`[singleInstance] Killed ${killed} process(es) (main pid=${mainPid})`)
  }
}
