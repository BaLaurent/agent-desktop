/**
 * Electron adapter for the core streaming module.
 *
 * ARCHITECTURE NOTE — do NOT "fix" the re-exports at the bottom of this file.
 *
 * This file has two distinct responsibilities:
 *   1. Electron-bound wiring — registering BrowserWindow instances for IPC,
 *      and injecting Electron-specific implementations (chunk sender, session
 *      manager, PI backend, macOS OAuth refresh, etc.) into core via the
 *      injectable-dependency slots defined in `core/services/streaming`.
 *   2. Re-export facade — every `export { x } from '../../core/services/streaming'`
 *      below is an intentional import-path alias so that callers in
 *      `main/` can import from one stable path rather than reaching into core
 *      directly. The dedup analyzer flags these as "duplicates" because the
 *      same name appears in two files; this is a false positive — there is no
 *      duplicated implementation.
 *
 * New shared streaming logic → `src/core/services/streaming.ts`.
 * New Electron-only primitives → this file only.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { getMainWindow } from '../mainContext'
import {
  setChunkSender,
  setSessionManager,
  setPIBackend,
  setEnsureFreshToken,
  setPISchedulerBridge,
} from '../../core/services/streaming'
import { setPIUISender, respondPIUI } from '../../core/services/pi/piUIChannel'
import type { PiUIResponse } from '../../core/types/piUITypes'
import { sendTurn, respondToSessionApproval, abortSession, hasActiveSession } from './sessionManager'
import { streamMessageOmp } from '../../core/services/streamingOmp'
import { ensureFreshMacOSToken } from '../utils/env'
import { getSchedulerMcpConfig, socketPath as schedSocketPath, authToken as schedAuthToken } from './schedulerBridge'

// Registry of windows that receive stream events (main window + overlay)
const streamWindows = new Set<BrowserWindow>()

export function registerStreamWindow(win: BrowserWindow): void {
  streamWindows.add(win)
  win.on('closed', () => streamWindows.delete(win))
}

// Wire the Electron chunk sender into the core streaming module
setChunkSender((channel: string, payload: Record<string, unknown>) => {
  for (const win of streamWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, channel === 'messages:conversationUpdated' ? payload.conversationId : payload)
    }
  }
  if (streamWindows.size === 0) {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, channel === 'messages:conversationUpdated' ? payload.conversationId : payload)
    }
  }
})

// Wire the Electron PI extension-UI sender: omp's rich extension_ui_request
// frames (notify/setWidget/setStatus/editor) reach the renderer's dormant
// extension-UI surface over `pi:uiEvent` / `pi:uiRequest`, and the renderer's
// answer returns over `pi:uiResponse` → respondPIUI → the omp client.
setPIUISender((channel: string, payload: unknown) => {
  for (const win of streamWindows) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  if (streamWindows.size === 0) {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
})

// Guard: in unit tests `electron` resolves to a path string, so `ipcMain` is
// undefined. The real app always has it; the guard keeps module import safe.
ipcMain?.on('pi:uiResponse', (_e, response: PiUIResponse) => {
  respondPIUI(response)
})

// Wire session manager into core streaming
setSessionManager({
  sendTurn,
  respondToApproval: respondToSessionApproval,
  abortSession,
  hasActiveSession,
})

// Wire PI backend into core streaming
setPIBackend(streamMessageOmp)


// Wire the in-process scheduler bridge for PI's `agent_scheduler` custom tool.
// Live bindings: reading socketPath/authToken returns whatever startBridge() has set.
setPISchedulerBridge({
  getMcpConfig: (conversationId: number) => getSchedulerMcpConfig(conversationId),
  getSocketPath: () => schedSocketPath,
  getAuthToken: () => schedAuthToken,
})

// Wire macOS OAuth token refresh into core streaming
setEnsureFreshToken(ensureFreshMacOSToken)


// Re-export everything from core so existing imports work
export {
  abortControllers,
  respondToApproval,
  sendChunk,
  setChunkSender,
  buildPromptWithHistory,
  injectApiKeyEnv,
  streamMessage,
  notifyConversationUpdated,
  abortStream,
} from '../../core/services/streaming'

export type { AISettings } from '../../core/services/streaming'
