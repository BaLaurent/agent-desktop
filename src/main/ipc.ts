import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'
import { sanitizeError } from './utils/errors'

import { registerHandlers as authHandlers } from './services/auth'
import { registerHandlers as conversationsHandlers } from './services/conversations'
import { registerHandlers as messagesHandlers } from './services/messages'

import { registerHandlers as foldersHandlers } from './services/folders'
import { registerHandlers as mcpHandlers } from './services/mcp'
import { registerHandlers as toolsHandlers } from './services/tools'
import { registerHandlers as knowledgeHandlers, ensureKnowledgesDir } from './services/knowledge'
import { registerHandlers as filesHandlers } from './services/files'
import { registerHandlers as attachmentsHandlers } from './services/attachments'
import { registerHandlers as settingsHandlers } from './services/settings'
import { registerHandlers as themesHandlers, ensureThemeDir } from './services/themes'
import { registerHandlers as shortcutsHandlers } from './services/shortcuts'
import { registerHandlers as systemHandlers } from './services/system'
import { registerHandlers as whisperHandlers } from './services/whisper'
import { registerHandlers as openscadHandlers } from './services/openscad'
import { registerHandlers as commandsHandlers } from './services/commands'
import { registerHandlers as quickChatHandlers } from './services/quickChat'
import { registerHandlers as schedulerHandlers } from './services/scheduler'
import { registerHandlers as ttsHandlers } from './services/tts'
import { registerHandlers as updaterHandlers } from './services/updater'

const serviceModules = [
  authHandlers,
  conversationsHandlers,
  messagesHandlers,

  foldersHandlers,
  mcpHandlers,
  toolsHandlers,
  knowledgeHandlers,
  filesHandlers,
  attachmentsHandlers,
  settingsHandlers,
  shortcutsHandlers,
  systemHandlers,
  whisperHandlers,
  openscadHandlers,
  quickChatHandlers,
  schedulerHandlers,
  ttsHandlers,
]

/**
 * Wrap ipcMain.handle() so all unhandled errors are sanitized
 * before reaching the renderer (strips internal file paths).
 */
function withSanitizedErrors(ipcMain: IpcMain): IpcMain {
  const original = ipcMain.handle.bind(ipcMain)
  const wrapped = Object.create(ipcMain) as IpcMain
  wrapped.handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    original(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      try {
        return await listener(event, ...args)
      } catch (err) {
        throw new Error(sanitizeError(err))
      }
    })
  }
  return wrapped
}

export function registerAllHandlers(ipcMain: IpcMain, db: Database.Database): void {
  const safeIpc = withSanitizedErrors(ipcMain)
  for (const register of serviceModules) {
    register(safeIpc, db)
  }
  themesHandlers(safeIpc)
  commandsHandlers(safeIpc)
  updaterHandlers(safeIpc)
  ensureThemeDir().catch((err) => console.error('[themes] Failed to ensure theme dir:', err))
  ensureKnowledgesDir().catch((err) => console.error('[knowledge] Failed to ensure knowledges dir:', err))
}
