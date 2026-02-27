import { resolve, normalize, sep } from 'path'
import { expandTilde } from '../utils/paths'
import type { CwdWhitelistEntry } from '../../shared/types'

/**
 * Checks whether a file path resolves outside the given CWD.
 * Returns the resolved absolute path if outside, null if inside.
 * Expands ~ to home directory before resolving.
 */
export function isPathOutsideCwd(filePath: string, cwd: string): string | null {
  const expanded = expandTilde(filePath)
  let normalizedCwd = normalize(cwd)
  // Strip trailing separator (normalize preserves it on POSIX)
  if (normalizedCwd.endsWith(sep) && normalizedCwd !== sep) {
    normalizedCwd = normalizedCwd.slice(0, -1)
  }
  const resolved = normalize(resolve(cwd, expanded))

  if (resolved === normalizedCwd) return null
  if (resolved.startsWith(normalizedCwd + sep)) return null

  return resolved
}

/**
 * Checks whether a file path is outside the CWD AND all additional writable paths.
 * Returns the resolved absolute path if outside all allowed dirs, null if inside any.
 */
export function isPathOutsideAllowed(filePath: string, cwd: string, additionalPaths?: string[]): string | null {
  // First check CWD
  const outsideCwd = isPathOutsideCwd(filePath, cwd)
  if (!outsideCwd) return null  // inside CWD, allow

  // Check additional writable paths
  if (additionalPaths) {
    for (const allowed of additionalPaths) {
      const outsideAllowed = isPathOutsideCwd(filePath, allowed)
      if (!outsideAllowed) return null  // inside an additional allowed path
    }
  }

  return outsideCwd  // outside all allowed paths
}

/**
 * Checks whether a file path is outside CWD and all whitelist entries (both read and readwrite).
 * Returns null if inside any allowed read dir, resolved path if outside all.
 */
export function isPathOutsideReadAllowed(filePath: string, cwd: string, whitelist: CwdWhitelistEntry[]): string | null {
  const outsideCwd = isPathOutsideCwd(filePath, cwd)
  if (!outsideCwd) return null

  for (const entry of whitelist) {
    const outside = isPathOutsideCwd(filePath, entry.path)
    if (!outside) return null
  }

  return outsideCwd
}

/**
 * Checks whether a file path is outside CWD and all readwrite whitelist entries.
 * Read-only entries do NOT grant write access.
 * Returns null if inside any writable dir, resolved path if outside all.
 */
export function isPathOutsideWriteAllowed(filePath: string, cwd: string, whitelist: CwdWhitelistEntry[]): string | null {
  const outsideCwd = isPathOutsideCwd(filePath, cwd)
  if (!outsideCwd) return null

  for (const entry of whitelist) {
    if (entry.access === 'readwrite') {
      const outside = isPathOutsideCwd(filePath, entry.path)
      if (!outside) return null
    }
  }

  return outsideCwd
}

/**
 * Best-effort extraction of write-target paths from a Bash command.
 * Detects redirections (>, >>), and common write commands (tee, cp, mv, etc.).
 */
export function extractBashWritePaths(command: string): string[] {
  const paths = new Set<string>()

  // Redirections: > file, >> file
  const redirectRegex = />{1,2}\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g
  let match: RegExpExecArray | null
  while ((match = redirectRegex.exec(command)) !== null) {
    const p = match[1] || match[2] || match[3]
    if (p) paths.add(p)
  }

  // tee: output goes to listed files
  const teeRegex = /\btee\s+(?:-[a-z]\s+)*(?:"([^"]+)"|'([^']+)'|(\S+))/g
  while ((match = teeRegex.exec(command)) !== null) {
    const p = match[1] || match[2] || match[3]
    if (p && !p.startsWith('-')) paths.add(p)
  }

  // cp/install: last argument is destination
  const cpRegex = /\b(?:cp|install)\s+(?:-[a-zA-Z]+\s+)*(.+)/g
  while ((match = cpRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    if (args.length >= 2) paths.add(args[args.length - 1])
  }

  // mv: last argument is destination
  const mvRegex = /\bmv\s+(?:-[a-zA-Z]+\s+)*(.+)/g
  while ((match = mvRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    if (args.length >= 2) paths.add(args[args.length - 1])
  }

  // mkdir: all non-flag arguments
  const mkdirRegex = /\bmkdir\s+(.+?)(?:[;&|]|$)/g
  while ((match = mkdirRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  // touch: all non-flag arguments
  const touchRegex = /\btouch\s+(.+?)(?:[;&|]|$)/g
  while ((match = touchRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  // ln: last argument is destination
  const lnRegex = /\bln\s+(?:-[a-zA-Z]+\s+)*(.+)/g
  while ((match = lnRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    if (args.length >= 2) paths.add(args[args.length - 1])
  }

  // rsync: last argument is destination
  const rsyncRegex = /\brsync\s+(?:-[a-zA-Z]+\s+)*(.+)/g
  while ((match = rsyncRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    if (args.length >= 2) paths.add(args[args.length - 1])
  }

  return Array.from(paths)
}

/**
 * Best-effort extraction of read-target paths from a Bash command.
 * Detects common read commands: cat, head, tail, less, find, ls, tree, file, stat, wc, diff, strings, xxd.
 */
export function extractBashReadPaths(command: string): string[] {
  const paths = new Set<string>()

  // Single-target read commands: extract all non-flag arguments
  const singleTargetCmds = ['cat', 'head', 'tail', 'less', 'file', 'stat', 'wc', 'strings', 'xxd']
  for (const cmd of singleTargetCmds) {
    const regex = new RegExp(`\\b${cmd}\\s+(.+?)(?:[;&|]|$)`, 'g')
    let match: RegExpExecArray | null
    while ((match = regex.exec(command)) !== null) {
      const args = splitShellArgs(match[1])
      for (const arg of args) {
        if (!arg.startsWith('-')) paths.add(arg)
      }
    }
  }

  // find: first non-flag argument is the search path
  const findRegex = /\bfind\s+(.+?)(?:[;&|]|$)/g
  let match: RegExpExecArray | null
  while ((match = findRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) {
        paths.add(arg)
        break  // find's first non-flag arg is the path
      }
    }
  }

  // ls: all non-flag arguments
  const lsRegex = /\bls\s+(.+?)(?:[;&|]|$)/g
  while ((match = lsRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  // tree: all non-flag arguments
  const treeRegex = /\btree\s+(.+?)(?:[;&|]|$)/g
  while ((match = treeRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  // diff: both non-flag arguments are paths
  const diffRegex = /\bdiff\s+(.+?)(?:[;&|]|$)/g
  while ((match = diffRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  return Array.from(paths)
}

/** Naive shell arg splitter — handles simple quoting */
function splitShellArgs(s: string): string[] {
  const args: string[] = []
  const regex = /"([^"]+)"|'([^']+)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(s)) !== null) {
    const val = m[1] || m[2] || m[3]
    // Stop at shell operators
    if (val === '|' || val === ';' || val === '&&' || val === '||') break
    if (val) args.push(val)
  }
  return args
}

// ─── SDK Hook Types ──────────────────────────────────────────

/** Input object passed to PreToolUse hook callbacks by the Agent SDK */
interface PreToolUseHookInput {
  hook_event_name: string
  tool_name: string
  tool_input: Record<string, unknown>
  session_id: string
  cwd: string
  [key: string]: unknown
}

interface HookResult {
  hookSpecificOutput?: {
    hookEventName: string
    permissionDecision: 'allow' | 'deny' | 'ask'
    permissionDecisionReason: string
  }
}

/** SDK HookCallback signature: (input, toolUseID, context) */
type HookCallback = (
  input: PreToolUseHookInput,
  toolUseId: string | null,
  context: { signal: AbortSignal }
) => Promise<HookResult>

/** Normalize legacy string[] to CwdWhitelistEntry[] (all readwrite) */
function normalizeWhitelist(input?: CwdWhitelistEntry[] | string[]): CwdWhitelistEntry[] | undefined {
  if (!input || input.length === 0) return undefined
  if (typeof input[0] === 'string') {
    return (input as string[]).map(p => ({ path: p, access: 'readwrite' as const }))
  }
  return input as CwdWhitelistEntry[]
}

/**
 * Builds SDK-compatible hooks for CWD restriction.
 * Uses the correct Agent SDK hooks API:
 *   hooks: { PreToolUse: [{ matcher: '...', hooks: [callback] }] }
 *
 * The callback follows the SDK signature: (input, toolUseID, { signal })
 * and returns { hookSpecificOutput: { hookEventName, permissionDecision, ... } }
 *
 * When whitelist is provided, read tools (Read, Glob, Grep) are also checked
 * and Bash read commands are validated against read-allowed directories.
 *
 * Accepts either CwdWhitelistEntry[] or legacy string[] (treated as readwrite).
 */
export function buildCwdRestrictionHooks(cwd: string, whitelistOrPaths?: CwdWhitelistEntry[] | string[]) {
  const whitelist = normalizeWhitelist(whitelistOrPaths)
  const hasWhitelist = whitelist && whitelist.length > 0

  const cwdRestrictionHook: HookCallback = async (input, _toolUseId, _context) => {
    const toolName = input.tool_name
    const toolInput = input.tool_input

    // Read tool: check file_path (only when whitelist is non-empty)
    if (toolName === 'Read' && hasWhitelist) {
      const filePath = toolInput.file_path as string | undefined
      if (filePath) {
        const outside = isPathOutsideReadAllowed(filePath, cwd, whitelist)
        if (outside) {
          return makeDenyResult(input.hook_event_name, toolName, outside, cwd, whitelist)
        }
      }
      return {}
    }

    // Glob: check path (only when whitelist is non-empty)
    if (toolName === 'Glob' && hasWhitelist) {
      const globPath = toolInput.path as string | undefined
      if (globPath) {
        const outside = isPathOutsideReadAllowed(globPath, cwd, whitelist)
        if (outside) {
          return makeDenyResult(input.hook_event_name, toolName, outside, cwd, whitelist)
        }
      }
      return {}
    }

    // Grep: check path (only when whitelist is non-empty)
    if (toolName === 'Grep' && hasWhitelist) {
      const grepPath = toolInput.path as string | undefined
      if (grepPath) {
        const outside = isPathOutsideReadAllowed(grepPath, cwd, whitelist)
        if (outside) {
          return makeDenyResult(input.hook_event_name, toolName, outside, cwd, whitelist)
        }
      }
      return {}
    }

    // Write / Edit: check file_path
    if (toolName === 'Write' || toolName === 'Edit') {
      const filePath = toolInput.file_path as string | undefined
      if (filePath) {
        const outside = hasWhitelist
          ? isPathOutsideWriteAllowed(filePath, cwd, whitelist)
          : isPathOutsideAllowed(filePath, cwd)
        if (outside) {
          return makeDenyResult(input.hook_event_name, toolName, outside, cwd, hasWhitelist ? whitelist : undefined)
        }
      }
      return {}
    }

    // NotebookEdit: check notebook_path
    if (toolName === 'NotebookEdit') {
      const nbPath = toolInput.notebook_path as string | undefined
      if (nbPath) {
        const outside = hasWhitelist
          ? isPathOutsideWriteAllowed(nbPath, cwd, whitelist)
          : isPathOutsideAllowed(nbPath, cwd)
        if (outside) {
          return makeDenyResult(input.hook_event_name, 'NotebookEdit', outside, cwd, hasWhitelist ? whitelist : undefined)
        }
      }
      return {}
    }

    // Bash: best-effort parse for write targets + read targets (when whitelist exists)
    if (toolName === 'Bash') {
      const command = toolInput.command as string | undefined
      if (command) {
        // Check write paths
        const writePaths = extractBashWritePaths(command)
        for (const p of writePaths) {
          const outside = hasWhitelist
            ? isPathOutsideWriteAllowed(p, cwd, whitelist)
            : isPathOutsideAllowed(p, cwd)
          if (outside) {
            return makeDenyResult(input.hook_event_name, 'Bash', outside, cwd, hasWhitelist ? whitelist : undefined)
          }
        }

        // Check read paths (only when whitelist is non-empty)
        if (hasWhitelist) {
          const readPaths = extractBashReadPaths(command)
          for (const p of readPaths) {
            const outside = isPathOutsideReadAllowed(p, cwd, whitelist)
            if (outside) {
              return makeDenyResult(input.hook_event_name, 'Bash', outside, cwd, whitelist)
            }
          }
        }
      }
      return {}
    }

    // Unknown tools: allow
    return {}
  }

  const matcher = hasWhitelist
    ? 'Write|Edit|NotebookEdit|Bash|Read|Glob|Grep'
    : 'Write|Edit|NotebookEdit|Bash'

  return {
    PreToolUse: [
      { matcher, hooks: [cwdRestrictionHook] },
    ],
  }
}

function makeDenyResult(
  hookEventName: string,
  toolName: string,
  resolvedPath: string,
  cwd: string,
  whitelist?: CwdWhitelistEntry[]
): HookResult {
  let allowedDirs: string
  if (whitelist && whitelist.length > 0) {
    const dirs = [`"${cwd}" (readwrite)`, ...whitelist.map(e => `"${e.path}" (${e.access})`)].join(', ')
    allowedDirs = dirs
  } else {
    allowedDirs = `"${cwd}"`
  }
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: 'deny',
      permissionDecisionReason: `${toolName} targets "${resolvedPath}" which is outside the allowed directories (${allowedDirs}). Write operations are restricted.`,
    },
  }
}
