// Ported from src/main/services/commands.ts. Registers `commands:list` + `macros:load` on the
// dispatch registry (origin 'local'). No Electron API surface — only the IpcMain type was swapped
// for HandleRegistrar and the util imports point at their canonical core locations. The pi-extension
// command discovery goes through the desktop-ported ./piExtensions sibling.
import * as path from "node:path";
import type Database from "better-sqlite3";
import type { HandleRegistrar } from "../../core/dispatch";
import type { SlashCommand } from "../../shared/types";
import { expandTilde } from "../../core/utils/paths";
import { validatePathSafe } from "../../core/utils/validate";
import { getSetting } from "../../core/utils/db";
import {
  BUILTIN_COMMANDS,
  scanCommandsDir,
  scanSkillsDir,
  scanMacrosDir,
  loadMacro,
} from "../../core/handlers/commands";
import { discoverOmpCommandsCached } from "../../core/services/pi/ompCommands";
import { discoverPIExtensionCommands } from "./piExtensions";

export function registerHandlers(dispatch: HandleRegistrar, db: Database.Database): void {
  dispatch.handle("commands:list", async (_event, cwd?: unknown, skillsMode?: unknown) => {
    const results = new Map<string, SlashCommand>();

    for (const cmd of BUILTIN_COMMANDS) {
      results.set(cmd.name, cmd as SlashCommand);
    }

    // Oh My Pi backend: expose omp's native command enumeration (superset of the manual claude scan
    // below) plus app-level builtins + macros. See the core handler for the same branch.
    if (getSetting(db, "ai_sdkBackend") === "pi") {
      let safeCwd: string | null = null;
      if (typeof cwd === "string") {
        try {
          safeCwd = validatePathSafe(cwd);
        } catch {
          safeCwd = null;
        }
      }
      const model = getSetting(db, "ai_model") || undefined;
      const ompCmds = await discoverOmpCommandsCached({ cwd: safeCwd ?? process.cwd(), model });
      for (const cmd of ompCmds) {
        results.set(cmd.name, { name: cmd.name, description: cmd.description, source: cmd.source });
      }
      const piMacros = await scanMacrosDir();
      for (const macro of piMacros) {
        results.set(macro.name, macro as SlashCommand);
      }
      return Array.from(results.values());
    }

    const claudeDir = expandTilde("~/.claude");
    const userCommands = await scanCommandsDir(path.join(claudeDir, "commands"), "user");
    for (const cmd of userCommands) {
      results.set(cmd.name, cmd as SlashCommand);
    }

    if (typeof cwd === "string") {
      try {
        const safeCwd = validatePathSafe(cwd);
        const projectCommands = await scanCommandsDir(path.join(safeCwd, ".claude", "commands"), "project");
        for (const cmd of projectCommands) {
          results.set(cmd.name, cmd as SlashCommand);
        }
      } catch {
        // Invalid cwd — skip project commands
      }
    }

    if (typeof skillsMode === "string" && skillsMode !== "off") {
      const userSkills = await scanSkillsDir(path.join(claudeDir, "skills"));
      for (const skill of userSkills) {
        results.set(skill.name, skill as SlashCommand);
      }

      if ((skillsMode === "project" || skillsMode === "local") && typeof cwd === "string") {
        try {
          const safeCwd = validatePathSafe(cwd);
          const projectSkills = await scanSkillsDir(path.join(safeCwd, ".claude", "skills"));
          for (const skill of projectSkills) {
            results.set(skill.name, skill as SlashCommand);
          }
        } catch {
          // Invalid cwd — skip project skills
        }
      }
    }

    const macros = await scanMacrosDir();
    for (const macro of macros) {
      results.set(macro.name, macro as SlashCommand);
    }

    // Pi extension commands — depends on omp command discovery via the ported piExtensions sibling.
    try {
      const piCommands = await discoverPIExtensionCommands(getSetting(db, "pi_extensionsDir") || undefined);
      for (const cmd of piCommands) {
        results.set(cmd.name, cmd);
      }
    } catch {
      // Extension discovery failed — skip
    }

    return Array.from(results.values());
  });

  dispatch.handle("macros:load", async (_event, name: unknown) => {
    if (typeof name !== "string") return null;
    return loadMacro(name);
  });
}
