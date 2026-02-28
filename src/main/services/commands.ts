import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import * as fs from 'fs/promises'
import * as path from 'path'
import { expandTilde } from '../utils/paths'
import { validatePathSafe } from '../utils/validate'
import type { SlashCommand } from '../../shared/types'
import { discoverPIExtensionCommands } from './piExtensions'

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Compact conversation history', source: 'builtin' },
  { name: 'clear', description: 'Clear AI context (messages stay visible)', source: 'builtin' },
  { name: 'help', description: 'Show available commands', source: 'builtin' },
]

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/
const DESCRIPTION_RE = /^description:\s*(.+)$/m
const NAME_RE = /^name:\s*(.+)$/m

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

/** Read first 2KB of a file and parse frontmatter */
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
    // Can't read file — return empty
  }
  return { description: '' }
}

async function scanCommandsDir(dir: string, source: 'user' | 'project'): Promise<SlashCommand[]> {
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

const MACROS_DIR = expandTilde('~/.agent-desktop/macros')

interface MacroFile {
  description?: string
  messages: string[]
}

async function scanMacrosDir(): Promise<SlashCommand[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(MACROS_DIR)
  } catch {
    return []
  }

  const macros: SlashCommand[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const name = entry.slice(0, -5)
    try {
      const raw = await fs.readFile(path.join(MACROS_DIR, entry), 'utf-8')
      const parsed = JSON.parse(raw) as MacroFile
      if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
        macros.push({ name, description: parsed.description || '', source: 'macro' })
      }
    } catch {
      // Invalid JSON or unreadable — skip
    }
  }
  return macros
}

async function loadMacro(name: string): Promise<string[] | null> {
  try {
    const filePath = path.join(MACROS_DIR, `${name}.json`)
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

async function scanSkillsDir(dir: string): Promise<SlashCommand[]> {
  let entries: fs.Dirent[] | string[]
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
    // Use frontmatter name if available, else folder name
    const name = fm.name || dirName
    skills.push({ name, description: fm.description, source: 'skill' })
  }

  return skills
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('commands:list', async (_event, cwd?: string, skillsMode?: string) => {
    const results = new Map<string, SlashCommand>()

    // Builtin commands (lowest priority)
    for (const cmd of BUILTIN_COMMANDS) {
      results.set(cmd.name, cmd)
    }

    // User commands (~/.claude/commands/)
    const claudeDir = expandTilde('~/.claude')
    const userCommandsDir = path.join(claudeDir, 'commands')
    const userCommands = await scanCommandsDir(userCommandsDir, 'user')
    for (const cmd of userCommands) {
      results.set(cmd.name, cmd)
    }

    // Project commands ({cwd}/.claude/commands/)
    if (cwd && typeof cwd === 'string') {
      try {
        const safeCwd = validatePathSafe(cwd)
        const projectDir = path.join(safeCwd, '.claude', 'commands')
        const projectCommands = await scanCommandsDir(projectDir, 'project')
        for (const cmd of projectCommands) {
          results.set(cmd.name, cmd)
        }
      } catch {
        // Invalid cwd — skip project commands
      }
    }

    // Skills (~/.claude/skills/ and {cwd}/.claude/skills/)
    if (skillsMode && skillsMode !== 'off') {
      // User skills (always when not 'off')
      const userSkillsDir = path.join(claudeDir, 'skills')
      const userSkills = await scanSkillsDir(userSkillsDir)
      for (const skill of userSkills) {
        results.set(skill.name, skill)
      }

      // Project skills (only in 'project' mode)
      if ((skillsMode === 'project' || skillsMode === 'local') && cwd && typeof cwd === 'string') {
        try {
          const safeCwd = validatePathSafe(cwd)
          const projectSkillsDir = path.join(safeCwd, '.claude', 'skills')
          const projectSkills = await scanSkillsDir(projectSkillsDir)
          for (const skill of projectSkills) {
            results.set(skill.name, skill)
          }
        } catch {
          // Invalid cwd — skip project skills
        }
      }
    }

    // Macros (~/.agent-desktop/macros/)
    const macros = await scanMacrosDir()
    for (const macro of macros) {
      results.set(macro.name, macro)
    }

    // Pi extension commands (always attempted — silently skipped if SDK unavailable)
    try {
      const extDirRow = db
        .prepare("SELECT value FROM settings WHERE key = 'pi_extensionsDir'")
        .get() as { value: string } | undefined
      const piCommands = await discoverPIExtensionCommands(extDirRow?.value || undefined)
      for (const cmd of piCommands) {
        results.set(cmd.name, cmd)
      }
    } catch {
      // PI SDK not available or extension discovery failed — skip
    }

    return Array.from(results.values())
  })

  ipcMain.handle('macros:load', async (_event, name: string) => {
    if (typeof name !== 'string') return null
    return loadMacro(name)
  })
}
