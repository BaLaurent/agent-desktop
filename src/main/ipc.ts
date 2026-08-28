import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AgentEngine } from '../core'
import { sanitizeError } from './utils/errors'
import { createLogger } from '../core/utils/logger'

const log = createLogger('ipc')

// Category C imports — Electron-only services that stay on ipcMain
import { registerHandlers as systemHandlers } from './services/system'
import { registerHandlers as whisperHandlers } from './services/whisper'
import { registerHandlers as quickChatHandlers } from './services/quickChat'
import { registerHandlers as schedulerHandlers } from './services/scheduler'
import { registerHandlers as ttsHandlers } from './services/tts'
import { registerHandlers as commandsHandlers } from './services/commands'
import { registerHandlers as updaterHandlers } from './services/updater'
import { registerHandlers as hotwordTrainerHandlers } from './services/hotwordTrainer'
import { registerHandlers as themesHandlers, ensureThemeDir } from './services/themes'
import { registerHandlers as filesHandlers } from './services/files'
import { registerHandlers as knowledgeHandlers, ensureKnowledgesDir } from './services/knowledge'

// Category B imports — platform-independent, in core, but registered here
import { registerWebServerHandlers } from '../core/services/webServer'
import { registerDiscordHandlers } from '../core/services/discord'

/**
 * Wrap ipcMain.handle() so all unhandled errors are sanitized
 * before reaching the renderer (strips internal file paths).
 * Also mirrors handlers into engine.dispatch so the web server
 * (which routes WS messages via dispatch) can access them.
 */
function withSanitizedErrors(ipcMain: IpcMain, engine: AgentEngine): IpcMain {
  const original = ipcMain.handle.bind(ipcMain)
  const wrapped = Object.create(ipcMain) as IpcMain
  wrapped.handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    // Skip channels already registered from engine.dispatch (mirrored in step 1)
    // — avoids "Attempted to register a second handler" for partially-migrated services
    if (engine.dispatch.has(channel)) return

    original(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      try {
        return await listener(event, ...args)
      } catch (err) {
        throw new Error(sanitizeError(err))
      }
    })
    // Mirror into engine.dispatch so WebSocket bridge can call the same handlers
    engine.dispatch.handle(channel, listener as (event: unknown, ...args: unknown[]) => unknown)
  }
  return wrapped
}

/**
 * Bridge engine-owned dispatch to Electron's IPC.
 * 1. Mirror all core dispatch handlers to ipcMain
 * 2. Register Category B (platform-independent, not yet in core handlers) on engine.dispatch + ipcMain
 * 3. Register Category C (Electron-only) services directly on ipcMain
 */
export function bridgeDispatchToIpc(engine: AgentEngine, ipcMain: IpcMain): void {
  // Track channels mirrored in step 1 so the step-2 loop can skip them explicitly
  const mirroredChannels = new Set<string>()

  // 1. Mirror all core dispatch handlers to ipcMain with error sanitization
  for (const [channel, handler] of engine.dispatch.entries()) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await handler(...args)
      } catch (err) {
        throw new Error(sanitizeError(err))
      }
    })
    mirroredChannels.add(channel)
  }

  // 2. Register Category B services on engine.dispatch (makes them available to webServer/discord/headless)
  registerWebServerHandlers(engine.dispatch, { webPassword: engine.webPassword, dispatch: engine.dispatch })
  registerDiscordHandlers(engine.dispatch, engine.dispatch)

  // Mirror Category B handlers that were just registered onto ipcMain
  // (they weren't in engine.dispatch during the loop above)
  for (const [channel, handler] of engine.dispatch.entries()) {
    // Skip channels already mirrored in step 1 — explicit guard replaces the
    // previous silent try/catch that swallowed Electron's "already registered" error
    if (mirroredChannels.has(channel)) continue
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await handler(...args)
      } catch (err) {
        throw new Error(sanitizeError(err))
      }
    })
    mirroredChannels.add(channel)
  }

  // 3. Register Category C (Electron-only) services on ipcMain AND engine.dispatch
  const safeIpc = withSanitizedErrors(ipcMain, engine)
  const db = engine.db as any

  systemHandlers(safeIpc, db)
  whisperHandlers(safeIpc, db)
  quickChatHandlers(safeIpc, db)
  schedulerHandlers(safeIpc, db)
  ttsHandlers(safeIpc, db)
  commandsHandlers(safeIpc, db)
  updaterHandlers(safeIpc)
  hotwordTrainerHandlers(safeIpc, db)
  themesHandlers(safeIpc)
  filesHandlers(safeIpc, db)
  knowledgeHandlers(safeIpc, db)

  // Fire-and-forget startup tasks
  ensureThemeDir().catch((err) => log.error('failed to ensure theme dir', err))
  ensureKnowledgesDir().catch((err) => log.error('failed to ensure knowledges dir', err))
}
