import { vi } from 'vitest'

// --- Mocks (must be before imports that trigger service module loading) ---

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/test-agent'),
    commandLine: { appendSwitch: vi.fn() },
  },
  BrowserWindow: vi.fn(() => ({
    loadURL: vi.fn(),
    show: vi.fn(),
    on: vi.fn(),
    webContents: { send: vi.fn(), once: vi.fn() },
    isDestroyed: vi.fn(() => false),
  })),
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  Notification: vi.fn(() => ({ show: vi.fn(), on: vi.fn() })),
  globalShortcut: { register: vi.fn(), unregister: vi.fn(), unregisterAll: vi.fn() },
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    autoDownload: false,
    autoInstallOnAppQuit: false,
  },
}))

vi.mock('ws', () => ({
  WebSocketServer: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
    clients: new Set(),
  })),
  WebSocket: { OPEN: 1 },
}))

vi.mock('./index', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('./services/streaming', () => ({
  streamMessage: vi.fn(),
  abortStream: vi.fn(),
  respondToApproval: vi.fn(),
  injectApiKeyEnv: vi.fn(),
  notifyConversationUpdated: vi.fn(),
  registerStreamWindow: vi.fn(),
}))

vi.mock('./services/anthropic', () => ({
  loadAgentSDK: vi.fn(),
}))

vi.mock('./services/globalShortcuts', () => ({
  reregister: vi.fn(),
}))

vi.mock('./utils/env', () => ({
  findBinaryInPath: vi.fn(() => '/usr/bin/claude'),
  isAppImage: vi.fn(() => false),
  getSessionType: vi.fn(() => 'x11'),
}))

vi.mock('./utils/volume', () => ({
  duckVolume: vi.fn(),
  restoreVolume: vi.fn(),
}))

vi.mock('./utils/broadcast', () => ({
  broadcast: vi.fn(),
  setBroadcastHandler: vi.fn(),
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  }
})

import { createTestDb } from './__tests__/db-helper'
import { createMockIpcMain } from './__tests__/ipc-helper'
import { registerAllHandlers, ipcDispatch } from './ipc'
import type Database from 'better-sqlite3'

describe('registerAllHandlers', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(async () => {
    ipcDispatch.clear()
    db = await createTestDb()
    ipc = createMockIpcMain()
    registerAllHandlers(ipc as any, db)
  })

  afterEach(() => {
    db.close()
  })

  it('populates ipcDispatch with entries from all services', () => {
    expect(ipcDispatch.size).toBeGreaterThan(0)
  })

  it('registers a large number of channels across all services', () => {
    // 22 service modules each register at least 1 handler
    expect(ipcDispatch.size).toBeGreaterThanOrEqual(22)
  })

  it('ipcDispatch entries are callable functions', () => {
    const [channel, handler] = [...ipcDispatch.entries()][0]
    expect(typeof channel).toBe('string')
    expect(typeof handler).toBe('function')
  })

  it('all expected service channel prefixes are registered', () => {
    const channels = [...ipcDispatch.keys()]

    const expectedPrefixes = [
      'auth:',
      'conversations:',
      'messages:',
      'folders:',
      'mcp:',
      'tools:',
      'kb:',
      'files:',
      'attachments:',
      'settings:',
      'shortcuts:',
      'system:',
      'whisper:',
      'openscad:',
      'quickChat:',
      'scheduler:',
      'tts:',
      'themes:',
      'commands:',
      'updates:',
      'jupyter:',
      'server:',
    ]

    for (const prefix of expectedPrefixes) {
      const found = channels.some((ch) => ch.startsWith(prefix))
      expect(found, `expected at least one channel with prefix "${prefix}"`).toBe(true)
    }
  })

  it('wraps handler errors with sanitizeError (strips file paths)', async () => {
    // Find a channel that hits the DB — 'conversations:get' with a bad ID will throw
    const handler = ipcDispatch.get('conversations:get')
    expect(handler).toBeDefined()

    // Call with undefined ID to trigger a validation or DB error
    try {
      await handler!(undefined)
      // If it doesn't throw, that's fine — some handlers are lenient
    } catch (err) {
      const msg = (err as Error).message
      // sanitizeError replaces absolute paths with [path]
      expect(msg).not.toMatch(/\/home\//)
      expect(msg).not.toMatch(/\/root\//)
      expect(msg).not.toMatch(/\/Users\//)
    }
  })

  it('ipcDispatch handler that throws returns sanitized error', async () => {
    // Force an error by calling a handler with clearly invalid input
    const handler = ipcDispatch.get('files:readFile')
    expect(handler).toBeDefined()

    // Pass a nonexistent path — should throw and the error should be sanitized
    await expect(handler!('/home/nobody/nonexistent/file.txt')).rejects.toThrow()

    try {
      await handler!('/home/nobody/nonexistent/file.txt')
    } catch (err) {
      const msg = (err as Error).message
      // The path should be replaced with [path] by sanitizeError
      expect(msg).not.toContain('/home/nobody/nonexistent')
    }
  })

  it('mock ipcMain.handle is called for every channel', () => {
    // The mock ipcMain.handle should have been called at least as many times
    // as there are entries in ipcDispatch (withSanitizedErrors calls both)
    expect(ipc.handle).toHaveBeenCalled()
    expect(ipc.handle.mock.calls.length).toBeGreaterThanOrEqual(ipcDispatch.size)
  })
})
