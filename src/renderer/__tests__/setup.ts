import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Captured stream listener callback — set when chatStore module registers its onStream handler
export let capturedStreamListener: ((chunk: unknown) => void) | null = null

export const mockAgent = {
  auth: {
    getStatus: vi.fn().mockResolvedValue({ authenticated: false, user: null }),
    login: vi.fn().mockResolvedValue({ authenticated: true, user: { email: 'test@test.com', name: 'Test' } }),
    logout: vi.fn().mockResolvedValue(undefined),
  },
  conversations: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: 1, title: 'Test', messages: [] }),
    create: vi.fn().mockResolvedValue({ id: 1, title: 'New Conversation', folder_id: null, position: 0, model: 'claude-sonnet-4-5-20250929', system_prompt: null, cwd: null, kb_enabled: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    export: vi.fn().mockResolvedValue(''),
    import: vi.fn().mockResolvedValue({ id: 2, title: 'Imported' }),
    search: vi.fn().mockResolvedValue([]),
    generateTitle: vi.fn().mockResolvedValue(undefined),
  },
  messages: {
    send: vi.fn().mockResolvedValue(null),
    stop: vi.fn().mockResolvedValue(undefined),
    regenerate: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
    respondToApproval: vi.fn().mockResolvedValue(undefined),
    onStream: vi.fn().mockImplementation((cb: (chunk: unknown) => void) => {
      capturedStreamListener = cb
      return () => {}
    }),
  },
  files: {
    listTree: vi.fn().mockResolvedValue([]),
    listDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue({ content: '', language: null }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    savePastedFile: vi.fn().mockResolvedValue('/tmp/test.png'),
    revealInFileManager: vi.fn().mockResolvedValue(undefined),
    openWithDefault: vi.fn().mockResolvedValue(undefined),
    trash: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue('/new/path'),
    duplicate: vi.fn().mockResolvedValue('/copy/path'),
    move: vi.fn().mockResolvedValue('/tmp/moved'),
    createFile: vi.fn().mockResolvedValue('/tmp/new.txt'),
    createFolder: vi.fn().mockResolvedValue('/tmp/newdir'),
  },
  folders: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1, name: 'Test Folder' }),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    reorder: vi.fn().mockResolvedValue(undefined),
  },
  mcp: {
    listServers: vi.fn().mockResolvedValue([]),
    addServer: vi.fn().mockResolvedValue({ id: 1 }),
    updateServer: vi.fn().mockResolvedValue(undefined),
    removeServer: vi.fn().mockResolvedValue(undefined),
    toggleServer: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue({ success: true, output: '' }),
  },
  tools: {
    listAvailable: vi.fn().mockResolvedValue([]),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    toggle: vi.fn().mockResolvedValue(undefined),
  },
  kb: {
    listCollections: vi.fn().mockResolvedValue([]),
    getCollectionFiles: vi.fn().mockResolvedValue([]),
    openKnowledgesFolder: vi.fn().mockResolvedValue(undefined),
  },
  settings: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
  },
  themes: {
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue({ filename: 'test.css', name: 'test', isBuiltin: false, css: '' }),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    save: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    getDir: vi.fn().mockResolvedValue('/tmp/themes'),
    refresh: vi.fn().mockResolvedValue([]),
  },
  shortcuts: {
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  },
  whisper: {
    transcribe: vi.fn().mockResolvedValue({ text: '' }),
    validateConfig: vi.fn().mockResolvedValue({ binaryFound: true, modelFound: true, binaryPath: 'whisper-cli', modelPath: '/model.bin' }),
  },
  system: {
    getPathForFile: vi.fn().mockReturnValue('/tmp/file'),
    getInfo: vi.fn().mockResolvedValue({ version: '0.1.0', electron: '33', node: '20', platform: 'linux', dbPath: '', configPath: '' }),
    getLogs: vi.fn().mockResolvedValue([]),
    clearCache: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    selectFolder: vi.fn().mockResolvedValue(null),
    selectFile: vi.fn().mockResolvedValue(null),
    showNotification: vi.fn().mockResolvedValue(undefined),
    purgeConversations: vi.fn().mockResolvedValue({ conversations: 0, folders: 0 }),
    purgeAll: vi.fn().mockResolvedValue({ conversations: 0 }),
  },
  events: {
    onTrayNewConversation: vi.fn().mockReturnValue(() => {}),
    onDeeplinkNavigate: vi.fn().mockReturnValue(() => {}),
    onConversationTitleUpdated: vi.fn().mockReturnValue(() => {}),
  },
  window: {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
  },
}

// Install global mock before any store modules load
// Use the existing jsdom window — do NOT replace it, just add agent
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(window, 'agent', {
  value: mockAgent,
  writable: true,
  configurable: true,
})

// Reset all mocks between tests
beforeEach(() => {
  for (const ns of Object.values(mockAgent)) {
    for (const fn of Object.values(ns)) {
      if (typeof fn === 'function' && 'mockClear' in fn) {
        (fn as ReturnType<typeof vi.fn>).mockClear()
      }
    }
  }
})
