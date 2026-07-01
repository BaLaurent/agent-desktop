import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import * as fs from 'fs/promises'
import * as path from 'path'
import { expandTilde } from '../utils/paths'
import { validatePathSafe } from '../utils/validate'
import { discoverOmpCommandsCached } from '../services/pi/ompCommands'

// ─── Types ──────────────────────────────────────────────────

interface SlashCommand {
  name: string
  description: string
  source: string
}

// ─── Constants ──────────────────────────────────────────────

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Compact conversation history', source: 'builtin' },
  { name: 'clear', description: 'Clear AI context (messages stay visible)', source: 'builtin' },
  { name: 'context', description: 'Show context used / free / total', source: 'builtin' },
  { name: 'help', description: 'Show available commands', source: 'builtin' },
]

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/
const DESCRIPTION_RE = /^description:\s*(.+)$/m
const NAME_RE = /^name:\s*(.+)$/m

export function getMacrosDir(): string {
  return expandTilde('~/.agent-desktop/macros')
}

/** Extract description from frontmatter, handling single-line, quoted, and YAML folded block (>) formats */
function extractDescription(frontmatter: string): string {
  // Try single-line: description: text  OR  description: "text"
  const lineMatch = frontmatter.match(DESCRIPTION_RE)
  if (lineMatch) {
    const val = lineMatch[1].trim()
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      return val.slice(1, -1)
    }
    // Folded block scalar (>): collect indented continuation lines
    if (val === '>') {
      const descIdx = frontmatter.indexOf('description:')
      const afterDesc = frontmatter.slice(descIdx)
      const lines = afterDesc.split('\n').slice(1) // skip the "description: >" line
      const parts: string[] = []
      for (const line of lines) {
        if (line.match(/^\s+/)) {
          parts.push(line.trim())
        } else {
          break // hit a non-indented line (next YAML key or end)
        }
      }
      return parts.join(' ')
    }
    return val
  }
  return ''
}

async function readFrontmatter(filePath: string): Promise<{ name?: string; description: string }> {
  try {
    const fd = await fs.open(filePath, 'r')
    try {
      const buf = Buffer.alloc(2048)
      const { bytesRead } = await fd.read(buf, 0, 2048)
      const head = buf.toString('utf-8', 0, bytesRead)
      const fmMatch = head.match(FRONTMATTER_RE)
      if (fmMatch) {
        const nameMatch = fmMatch[1].match(NAME_RE)
        return {
          name: nameMatch ? nameMatch[1].trim() : undefined,
          description: extractDescription(fmMatch[1]),
        }
      }
    } finally {
      await fd.close()
    }
  } catch {
    // Can't read file
  }
  return { description: '' }
}

export async function scanCommandsDir(dir: string, source: 'user' | 'project'): Promise<SlashCommand[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }

  const commands: SlashCommand[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const name = entry.slice(0, -3)
    const filePath = path.join(dir, entry)
    const fm = await readFrontmatter(filePath)
    commands.push({ name, description: fm.description, source })
  }
  return commands
}

interface MacroFile {
  description?: string
  messages: string[]
}

interface MacroFull {
  name: string
  description: string
  messages: string[]
}

// Strict name: letters, digits, dash, underscore. Forbids ".", "/", "..".
const MACRO_NAME_RE = /^[a-zA-Z0-9_-]+$/

function validateMacroName(name: unknown): name is string {
  return typeof name === 'string' && MACRO_NAME_RE.test(name) && name.length > 0 && name.length <= 64
}

const MACRO_DESCRIPTION_MAX = 500
const MACRO_MESSAGE_MAX = 20_000
const MACRO_MESSAGES_MAX = 100

function validateMacroPayload(payload: unknown): payload is MacroFile {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as Record<string, unknown>
  if (p.description !== undefined) {
    if (typeof p.description !== 'string') return false
    if (p.description.length > MACRO_DESCRIPTION_MAX) return false
  }
  if (!Array.isArray(p.messages)) return false
  if (p.messages.length === 0 || p.messages.length > MACRO_MESSAGES_MAX) return false
  return p.messages.every((m) => typeof m === 'string' && m.length > 0 && m.length <= MACRO_MESSAGE_MAX)
}

export async function scanMacrosDir(): Promise<SlashCommand[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(getMacrosDir())
  } catch {
    return []
  }

  const macros: SlashCommand[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const name = entry.slice(0, -5)
    try {
      const raw = await fs.readFile(path.join(getMacrosDir(), entry), 'utf-8')
      const parsed = JSON.parse(raw) as MacroFile
      if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        macros.push({ name, description: parsed.description || '', source: 'macro' })
      }
    } catch {
      // Invalid JSON or unreadable
    }
  }
  return macros
}

async function listMacrosFull(): Promise<MacroFull[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(getMacrosDir())
  } catch {
    return []
  }

  const macros: MacroFull[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const name = entry.slice(0, -5)
    if (!validateMacroName(name)) continue
    try {
      const raw = await fs.readFile(path.join(getMacrosDir(), entry), 'utf-8')
      const parsed = JSON.parse(raw) as MacroFile
      if (Array.isArray(parsed.messages) && parsed.messages.every((m) => typeof m === 'string') && parsed.messages.length > 0) {
        macros.push({
          name,
          description: typeof parsed.description === 'string' ? parsed.description : '',
          messages: parsed.messages,
        })
      }
    } catch {
      // Invalid JSON or unreadable
    }
  }
  macros.sort((a, b) => a.name.localeCompare(b.name))
  return macros
}

export async function loadMacro(name: string): Promise<string[] | null> {
  if (!validateMacroName(name)) return null
  try {
    const filePath = path.join(getMacrosDir(), `${name}.json`)
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as MacroFile
    if (Array.isArray(parsed.messages) && parsed.messages.every((m) => typeof m === 'string') && parsed.messages.length > 0) {
      return parsed.messages
    }
  } catch {
    // File not found or invalid
  }
  return null
}

async function saveMacro(name: string, description: string, messages: string[], oldName?: string): Promise<void> {
  if (!validateMacroName(name)) {
    throw new Error('Invalid macro name (use letters, digits, dash, underscore)')
  }
  if (!validateMacroPayload({ description, messages })) {
    throw new Error('Invalid macro content (messages must be a non-empty array of non-empty strings)')
  }
  await fs.mkdir(getMacrosDir(), { recursive: true })

  const payload: MacroFile = { description, messages }
  const serialized = JSON.stringify(payload, null, 2)
  const target = path.join(getMacrosDir(), `${name}.json`)

  // If this is a rename (oldName !== name), refuse to silently overwrite an unrelated macro
  if (oldName && oldName !== name) {
    try {
      await fs.access(target)
      throw new Error(`A macro named "${name}" already exists`)
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'ENOENT') throw err
      // ENOENT is the happy path — the target slot is free
    }
  }

  // Atomic write: write to .tmp then rename
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, serialized, 'utf-8')
  await fs.rename(tmp, target)

  // If renaming, drop the old file (only after the new one is safely on disk)
  if (oldName && oldName !== name && validateMacroName(oldName)) {
    const oldPath = path.join(getMacrosDir(), `${oldName}.json`)
    try {
      await fs.unlink(oldPath)
    } catch {
      // Old file already gone — not fatal
    }
  }
}

async function deleteMacro(name: string): Promise<void> {
  if (!validateMacroName(name)) {
    throw new Error('Invalid macro name')
  }
  const target = path.join(getMacrosDir(), `${name}.json`)
  try {
    await fs.unlink(target)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') throw err
  }
}

export async function scanSkillsDir(dir: string): Promise<SlashCommand[]> {
  let entries: import('fs').Dirent[] | string[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const skills: SlashCommand[] = []
  for (const entry of entries) {
    const dirName = typeof entry === 'string' ? entry : entry.name
    const isDir = typeof entry === 'string' ? false : entry.isDirectory()
    if (!isDir) continue

    const skillFile = path.join(dir, dirName, 'SKILL.md')
    const fm = await readFrontmatter(skillFile)
    const name = fm.name || dirName
    skills.push({ name, description: fm.description, source: 'skill' })
  }
  return skills
}

// ─── Handler registration ───────────────────────────────────

export function registerCommandsHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('commands:list', async (_event, cwd?: unknown, skillsMode?: unknown) => {
    const results = new Map<string, SlashCommand>()

    for (const cmd of BUILTIN_COMMANDS) {
      results.set(cmd.name, cmd)
    }

    // Oh My Pi backend: omp natively discovers + dedups commands from ALL
    // sources (native ~/.omp + cwd/.omp, ~/.claude/commands + project, codex,
    // opencode, plugins, agents, /skill:*). That is a superset of the manual
    // claude scan below, so for the pi backend we expose omp's own enumeration
    // (plus app-level builtins already added + macros) instead of re-scanning.
    const backendRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_sdkBackend') as { value: string | null } | undefined
    if (backendRow?.value === 'pi') {
      let safeCwd: string | null = null
      if (typeof cwd === 'string') {
        try { safeCwd = validatePathSafe(cwd) } catch { safeCwd = null }
      }
      const modelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_model') as { value: string | null } | undefined
      const model = modelRow?.value ?? undefined
      const ompCmds = await discoverOmpCommandsCached({ cwd: safeCwd ?? process.cwd(), model })
      for (const cmd of ompCmds) {
        results.set(cmd.name, { name: cmd.name, description: cmd.description, source: cmd.source })
      }
      const piMacros = await scanMacrosDir()
      for (const macro of piMacros) {
        results.set(macro.name, macro)
      }
      return Array.from(results.values())
    }

    const claudeDir = expandTilde('~/.claude')
    const userCommandsDir = path.join(claudeDir, 'commands')
    const userCommands = await scanCommandsDir(userCommandsDir, 'user')
    for (const cmd of userCommands) {
      results.set(cmd.name, cmd)
    }

    if (cwd && typeof cwd === 'string') {
      try {
        const safeCwd = validatePathSafe(cwd)
        const projectDir = path.join(safeCwd, '.claude', 'commands')
        const projectCommands = await scanCommandsDir(projectDir, 'project')
        for (const cmd of projectCommands) {
          results.set(cmd.name, cmd)
        }
      } catch {
        // Invalid cwd
      }
    }

    if (skillsMode && typeof skillsMode === 'string' && skillsMode !== 'off') {
      const userSkillsDir = path.join(claudeDir, 'skills')
      const userSkills = await scanSkillsDir(userSkillsDir)
      for (const skill of userSkills) {
        results.set(skill.name, skill)
      }

      if ((skillsMode === 'project' || skillsMode === 'local') && cwd && typeof cwd === 'string') {
        try {
          const safeCwd = validatePathSafe(cwd)
          const projectSkillsDir = path.join(safeCwd, '.claude', 'skills')
          const projectSkills = await scanSkillsDir(projectSkillsDir)
          for (const skill of projectSkills) {
            results.set(skill.name, skill)
          }
        } catch {
          // Invalid cwd
        }
      }
    }

    const macros = await scanMacrosDir()
    for (const macro of macros) {
      results.set(macro.name, macro)
    }

    // PI extension commands are skipped in core — they require the PI SDK
    // which depends on Electron paths. They remain Electron-only.

    return Array.from(results.values())
  })

  registrar.handle('macros:load', async (_event, name: unknown) => {
    if (typeof name !== 'string') return null
    return loadMacro(name)
  })

  registrar.handle('macros:list', async () => {
    return listMacrosFull()
  })

  registrar.handle('macros:save', async (_event, name: unknown, description: unknown, messages: unknown, oldName?: unknown) => {
    if (typeof name !== 'string') throw new Error('name must be a string')
    if (typeof description !== 'string') throw new Error('description must be a string')
    if (!Array.isArray(messages)) throw new Error('messages must be an array')
    const msgs = messages as unknown[]
    if (!msgs.every((m) => typeof m === 'string')) throw new Error('all messages must be strings')
    const old = typeof oldName === 'string' ? oldName : undefined
    await saveMacro(name, description, msgs as string[], old)
  })

  registrar.handle('macros:delete', async (_event, name: unknown) => {
    if (typeof name !== 'string') throw new Error('name must be a string')
    await deleteMacro(name)
  })
}
