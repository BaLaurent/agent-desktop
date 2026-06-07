import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import * as path from 'path'
import { expandTilde } from '../utils/paths'
import { validatePathSafe } from '../utils/validate'
import type { SlashCommand } from '../../shared/types'
import { discoverPIExtensionCommands } from './piExtensions'
import {
  BUILTIN_COMMANDS,
  scanCommandsDir,
  scanSkillsDir,
  scanMacrosDir,
  loadMacro,
} from '../../core/handlers/commands'
import { getSetting } from '../utils/db'

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('commands:list', async (_event, cwd?: string, skillsMode?: string) => {
    const results = new Map<string, SlashCommand>()

    for (const cmd of BUILTIN_COMMANDS) {
      results.set(cmd.name, cmd as SlashCommand)
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

    // Pi extension commands — Electron-only path (depends on PI SDK + Electron paths)
    try {
      const piCommands = await discoverPIExtensionCommands(getSetting(db, 'pi_extensionsDir') || undefined)
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
