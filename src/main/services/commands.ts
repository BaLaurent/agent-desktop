import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import * as path from 'path'
import { expandTilde } from '../utils/paths'
import { validatePathSafe } from '../utils/validate'
import type { SlashCommand } from '../../shared/types'
import {
  BUILTIN_COMMANDS,
  scanCommandsDir,
  scanSkillsDir,
  scanMacrosDir,
  loadMacro,
} from '../../core/handlers/commands'
import { discoverOmpCommandsCached } from '../../core/services/pi/ompCommands'
import { getSetting } from '../utils/db'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('commands:list', async (_event, cwd?: string, skillsMode?: string) => {
    const results = new Map<string, SlashCommand>()

    for (const cmd of BUILTIN_COMMANDS) {
      results.set(cmd.name, cmd as SlashCommand)
    }

    // Oh My Pi backend: expose omp's native command enumeration (superset of the
    // manual claude scan below) plus app-level builtins + macros. See the core
    // handler for the same branch.
    if (getSetting(db, 'ai_sdkBackend') === 'pi') {
      let safeCwd: string | null = null
      if (typeof cwd === 'string') {
        try { safeCwd = validatePathSafe(cwd) } catch { safeCwd = null }
      }
      const model = getSetting(db, 'ai_model') || undefined
      const ompCmds = await discoverOmpCommandsCached({ cwd: safeCwd ?? process.cwd(), model })
      for (const cmd of ompCmds) {
        results.set(cmd.name, { name: cmd.name, description: cmd.description, source: cmd.source })
      }
      const piMacros = await scanMacrosDir()
      for (const macro of piMacros) {
        results.set(macro.name, macro as SlashCommand)
      }
      return Array.from(results.values())
    }

    const claudeDir = expandTilde('~/.claude')
    const userCommands = await scanCommandsDir(path.join(claudeDir, 'commands'), 'user')
    for (const cmd of userCommands) {
      results.set(cmd.name, cmd as SlashCommand)
    }

    if (cwd && typeof cwd === 'string') {
      try {
        const safeCwd = validatePathSafe(cwd)
        const projectCommands = await scanCommandsDir(path.join(safeCwd, '.claude', 'commands'), 'project')
        for (const cmd of projectCommands) {
          results.set(cmd.name, cmd as SlashCommand)
        }
      } catch {
        // Invalid cwd — skip project commands
      }
    }

    if (skillsMode && skillsMode !== 'off') {
      const userSkills = await scanSkillsDir(path.join(claudeDir, 'skills'))
      for (const skill of userSkills) {
        results.set(skill.name, skill as SlashCommand)
      }

      if ((skillsMode === 'project' || skillsMode === 'local') && cwd && typeof cwd === 'string') {
        try {
          const safeCwd = validatePathSafe(cwd)
          const projectSkills = await scanSkillsDir(path.join(safeCwd, '.claude', 'skills'))
          for (const skill of projectSkills) {
            results.set(skill.name, skill as SlashCommand)
          }
        } catch {
          // Invalid cwd — skip project skills
        }
      }
    }

    const macros = await scanMacrosDir()
    for (const macro of macros) {
      results.set(macro.name, macro as SlashCommand)
    }

    return Array.from(results.values())
  })

  ipcMain.handle('macros:load', async (_event, name: string) => {
    if (typeof name !== 'string') return null
    return loadMacro(name)
  })
}
