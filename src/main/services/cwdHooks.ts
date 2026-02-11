import { resolve, normalize, sep } from 'path'
import { expandTilde } from '../utils/paths'

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

/**
 * Builds SDK-compatible hooks for CWD restriction.
 * Uses the correct Agent SDK hooks API:
 *   hooks: { PreToolUse: [{ matcher: '...', hooks: [callback] }] }
 *
 * The callback follows the SDK signature: (input, toolUseID, { signal })
 * and returns { hookSpecificOutput: { hookEventName, permissionDecision, ... } }
 */
export function buildCwdRestrictionHooks(cwd: string, additionalWritablePaths?: string[]) {
  const cwdRestrictionHook: HookCallback = async (input, _toolUseId, _context) => {
    const toolName = input.tool_name
    const toolInput = input.tool_input

    // Write / Edit: check file_path
    if (toolName === 'Write' || toolName === 'Edit') {
      const filePath = toolInput.file_path as string | undefined
      if (filePath) {
        const outside = isPathOutsideAllowed(filePath, cwd, additionalWritablePaths)
        if (outside) {
          return makeDenyResult(input.hook_event_name, toolName, outside, cwd, additionalWritablePaths)
        }
      }
      return {}
    }

    // NotebookEdit: check notebook_path
    if (toolName === 'NotebookEdit') {
      const nbPath = toolInput.notebook_path as string | undefined
      if (nbPath) {
        const outside = isPathOutsideAllowed(nbPath, cwd, additionalWritablePaths)
        if (outside) {
          return makeDenyResult(input.hook_event_name, 'NotebookEdit', outside, cwd, additionalWritablePaths)
        }
      }
      return {}
    }

    // Bash: best-effort parse for write targets
    if (toolName === 'Bash') {
      const command = toolInput.command as string | undefined
      if (command) {
        const writePaths = extractBashWritePaths(command)
        for (const p of writePaths) {
          const outside = isPathOutsideAllowed(p, cwd, additionalWritablePaths)
          if (outside) {
            return makeDenyResult(input.hook_event_name, 'Bash', outside, cwd, additionalWritablePaths)
          }
        }
      }
      return {}
    }

    // Read-only tools and unknown tools: allow
    return {}
  }

  return {
    PreToolUse: [
      { matcher: 'Write|Edit|NotebookEdit|Bash', hooks: [cwdRestrictionHook] },
    ],
  }
}

function makeDenyResult(
  hookEventName: string,
  toolName: string,
  resolvedPath: string,
  cwd: string,
  additionalPaths?: string[]
): HookResult {
  const allowedDirs = [cwd, ...(additionalPaths || [])].map(d => `"${d}"`).join(', ')
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: 'deny',
      permissionDecisionReason: `${toolName} targets "${resolvedPath}" which is outside the allowed directories (${allowedDirs}). Write operations are restricted.`,
    },
  }
}
