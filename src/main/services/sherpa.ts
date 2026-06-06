import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'

// sherpa channels (sherpa:transcribe, :validateConfig, :downloadModel) are registered by
// core/handlers/sherpa.ts via engine.dispatch. withSanitizedErrors in ipc.ts skips any
// ipcMain.handle for channels already in dispatch, so this stays a no-op stub.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerHandlers(_ipcMain: IpcMain, _db: Database.Database): void {}

// Re-export for testing — pure logic lives in core/services/sherpaStt.
export { detectArchitecture, transcribe, validateConfig } from '../../core/services/sherpaStt'
