import type Database from 'better-sqlite3'
import type { AllowedTool } from '../types'
import { validateString } from '../utils/validate'
import { safeJsonParse } from '../utils/json'
import { getSetting } from '../utils/db'

const SDK_TOOLS: { name: string; description: string }[] = [
  { name: 'Bash', description: 'Execute shell commands' },
  { name: 'Read', description: 'Read file contents' },
  { name: 'Edit', description: 'Edit files with string replacements' },
  { name: 'Write', description: 'Write or overwrite files' },
  { name: 'Glob', description: 'Find files by pattern' },
  { name: 'Grep', description: 'Search file contents with regex' },
  { name: 'WebFetch', description: 'Fetch and process web content' },
  { name: 'WebSearch', description: 'Search the web' },
  { name: 'NotebookEdit', description: 'Edit Jupyter notebook cells' },
  { name: 'Task', description: 'Launch subagent tasks' },
  { name: 'TodoWrite', description: 'Manage todo lists' },
]

function getEnabledSet(db: Database.Database): Set<string> | 'all' {
  const value = getSetting(db, 'ai_tools') || 'preset:claude_code'
  if (value === 'preset:claude_code') return 'all'
  const names = safeJsonParse<string[] | null>(value, null)
  return names ? new Set(names) : 'all'
}

function saveEnabledList(db: Database.Database, names: string[]): void {
  const value = names.length === SDK_TOOLS.length ? 'preset:claude_code' : JSON.stringify(names)
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_tools', ?)").run(value)
}

export class ToolsService {
  constructor(private db: Database.Database) {}

  listAvailable(): AllowedTool[] {
    const enabled = getEnabledSet(this.db)
    return SDK_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: enabled === 'all' || enabled.has(tool.name),
    }))
  }

  setEnabled(value: string): void {
    validateString(value, 'value', 10_000)
    if (value === 'preset:claude_code' || value === '[]') {
      this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_tools', ?)").run(value)
    } else {
      const names = safeJsonParse<string[] | null>(value, null)
      if (names) {
        saveEnabledList(this.db, names)
      } else {
        this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_tools', ?)").run(value)
      }
    }
  }

  toggle(toolName: string): void {
    validateString(toolName, 'toolName', 100)
    const enabled = getEnabledSet(this.db)
    const currentNames =
      enabled === 'all'
        ? SDK_TOOLS.map((t) => t.name)
        : SDK_TOOLS.filter((t) => enabled.has(t.name)).map((t) => t.name)

    const idx = currentNames.indexOf(toolName)
    if (idx >= 0) {
      currentNames.splice(idx, 1)
    } else {
      currentNames.push(toolName)
    }

    saveEnabledList(this.db, currentNames)
  }
}
