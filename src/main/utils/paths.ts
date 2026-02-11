import { homedir } from 'os'
import { sep } from 'path'

/** Expand leading ~ to user home directory (shell-style tilde expansion) */
export function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~' + sep)) return homedir() + p.slice(1)
  return p
}
