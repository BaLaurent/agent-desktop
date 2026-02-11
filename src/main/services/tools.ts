import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { AllowedTool } from '../../shared/types'
import { validateString } from '../utils/validate'
import { safeJsonParse } from '../utils/json'

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
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'ai_tools'")
    .get() as { value: string } | undefined

  const value = row?.value ?? 'preset:claude_code'
  if (value === 'preset:claude_code') return 'all'

  const names = safeJsonParse<string[] | null>(value, null)
  return names ? new Set(names) : 'all'
}

function saveEnabledList(db: Database.Database, names: string[]): void {
  const value = names.length === SDK_TOOLS.length ? 'preset:claude_code' : JSON.stringify(names)
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_tools', ?)").run(value)
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('tools:listAvailable', async (): Promise<AllowedTool[]> => {
    const enabled = getEnabledSet(db)
    return SDK_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: enabled === 'all' || enabled.has(tool.name),
    }))
  })

  ipcMain.handle('tools:setEnabled', async (_event, value: string): Promise<void> => {
    validateString(value, 'value', 10_000)
    if (value === 'preset:claude_code' || value === '[]') {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_tools', ?)").run(value)
    } else {
      const names = safeJsonParse<string[] | null>(value, null)
      if (names) {
        saveEnabledList(db, names)
      } else {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_tools', ?)").run(value)
      }
    }
  })

  ipcMain.handle('tools:toggle', async (_event, toolName: string): Promise<void> => {
    validateString(toolName, 'toolName', 100)
    const enabled = getEnabledSet(db)
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

    saveEnabledList(db, currentNames)
  })
}
