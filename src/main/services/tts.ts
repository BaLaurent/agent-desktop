import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import { getMainWindow } from '../mainContext'
import { broadcast } from '../utils/broadcast'
import { hasWebClients } from '../../core/services/webServer'
import {
  stop,
  speak,
  speakResponse,
  speakMessage,
  validateConfig,
  detectPlayers,
  listSayVoices,
  setSpeakingStateListener,
  setWebAudioSink,
} from '../../core/handlers/tts'

// ─── Electron state notification ────────────────────────────

setSpeakingStateListener((speaking, messageId) => {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('tts:stateChange', { speaking, messageId })
  }
  broadcast('tts:stateChange', { speaking, messageId })
})

// ─── Web audio routing ──────────────────────────────────────
//
// When a web client is connected, ship generated audio to the browser so it
// plays there (the local audio player would otherwise play on the server).
// Returns true when at least one web client is connected, signalling the core
// TTS pipeline to skip local playback.

setWebAudioSink({
  active: () => hasWebClients(),
  send: (audio) => broadcast('tts:audio', audio),
})

// ─── Re-exports (for main/index.ts consumers) ───────────────

export { stop, speak, speakResponse, speakMessage, validateConfig, detectPlayers, listSayVoices }

// ─── IPC handler registration (Category C — Electron-only) ──
// NOTE: tts:* channels are already registered in core dispatch.
// This registerHandlers is kept for ipc.ts compatibility but the
// withSanitizedErrors wrapper in ipc.ts skips duplicate channels,
// so these calls are effectively no-ops at runtime.
// They are preserved to avoid breaking the import chain in ipc.ts.

export function registerHandlers(_ipcMain: IpcMain, _db: Database.Database): void {
  // All tts:* channels are owned by core dispatch (registerTtsHandlers).
  // ipc.ts mirrors them to ipcMain automatically. Nothing to register here.
}
