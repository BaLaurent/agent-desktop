import { homedir } from 'os'
import { sep } from 'path'

/** Expand leading ~ to user home directory (shell-style tilde expansion) */
export function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~' + sep)) return homedir() + p.slice(1)
  return p
}

/**
 * Expand leading ~ in a stdio command and each of its args before spawning.
 * MCP stdio servers spawn with `shell: false`, so the OS never performs the
 * shell's tilde expansion — we must do it ourselves at the spawn boundary.
 */
export function expandStdioCommand(command: string, args: string[]): { command: string; args: string[] } {
  return { command: expandTilde(command), args: args.map(expandTilde) }
}
