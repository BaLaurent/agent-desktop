import { vi } from 'vitest'
import '@testing-library/jest-dom'
import type { AgentAPI } from '../../preload/api'

// Captured stream listener callback — set when chatStore module registers its onStream handler
export let capturedStreamListener: ((chunk: unknown) => void) | null = null
// Captured conversation-updated listeners — set when modules register their onConversationUpdated handlers
export const capturedConversationUpdatedListeners: Array<(conversationId: number) => void> = []
// Legacy single-listener alias (points to last registered)
export let capturedConversationUpdatedListener: ((conversationId: number) => void) | null = null
// Captured TTS state-change listener — set when ttsStore module registers its onStateChange handler
export let capturedTtsStateListener: ((state: { speaking: boolean; messageId?: number }) => void) | null = null
// Captured TTS audio listener — set when ttsStore module registers its onAudio handler
export let capturedTtsAudioListener: ((audio: { data: string; mime: string; messageId: number | null }) => void) | null = null
// Captured reconnect listener — set when chatStore registers its onReconnect handler
export let capturedReconnectListener: (() => void) | null = null

export const mockAgent = {
  auth: {
    getStatus: vi.fn().mockResolvedValue({ authenticated: false, user: null }),
    login: vi.fn().mockResolvedValue({ authenticated: true, user: { email: 'test@test.com', name: 'Test' } }),
    logout: vi.fn().mockResolvedValue(undefined),
  },
  conversations: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: 1, title: 'Test', messages: [] }),
    markOpened: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: 1, title: 'New Conversation', folder_id: 1, position: 0, model: 'claude-sonnet-4-6', system_prompt: null, cwd: null, kb_enabled: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(undefined),
    moveMany: vi.fn().mockResolvedValue(undefined),
    export: vi.fn().mockResolvedValue(''),
    import: vi.fn().mockResolvedValue({ id: 2, title: 'Imported' }),
    search: vi.fn().mockResolvedValue([]),
    generateTitle: vi.fn().mockResolvedValue(undefined),
    colorMany: vi.fn().mockResolvedValue(undefined),
    fork: vi.fn().mockResolvedValue({ id: 2, title: 'Forked', folder_id: 1, position: 0, model: 'claude-sonnet-4-6', system_prompt: null, cwd: null, kb_enabled: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  },
  messages: {
    send: vi.fn().mockResolvedValue(null),
    stop: vi.fn().mockResolvedValue(undefined),
    regenerate: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
    compact: vi.fn().mockResolvedValue({ summary: 'Test summary', clearedAt: '2025-01-01T00:00:00.000Z' }),
    respondToApproval: vi.fn().mockResolvedValue(undefined),
    onStream: vi.fn().mockImplementation((cb: (chunk: unknown) => void) => {
      capturedStreamListener = cb
      return () => {}
    }),
  },
  context: {
    getBreakdown: vi.fn().mockResolvedValue({
      total: 0, window: 200_000, autocompactBuffer: 6_000,
      free: 194_000, percentUsed: 0, categories: [], preFirstTurn: true,
    }),
    getSkillsOverhead: vi.fn().mockResolvedValue({
      off: { tokens: 0, count: 0 },
      user: { tokens: 0, count: 0 },
      project: { tokens: 0, count: 0 },
      local: { tokens: 0, count: 0 },
    }),
  },
  files: {
    listTree: vi.fn().mockResolvedValue([]),
    listDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue({ content: '', language: null }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    savePastedFile: vi.fn().mockResolvedValue('/tmp/test.png'),
    revealInFileManager: vi.fn().mockResolvedValue(undefined),
    openTerminalHere: vi.fn().mockResolvedValue(undefined),
    openWithDefault: vi.fn().mockResolvedValue(undefined),
    trash: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue('/new/path'),
    duplicate: vi.fn().mockResolvedValue('/copy/path'),
    move: vi.fn().mockResolvedValue('/tmp/moved'),
    createFile: vi.fn().mockResolvedValue('/tmp/new.txt'),
    createFolder: vi.fn().mockResolvedValue('/tmp/newdir'),
    prepareSession: vi.fn().mockResolvedValue({ cwd: '/tmp/session', count: 0 }),
  },
  folders: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1, name: 'Test Folder' }),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    reorder: vi.fn().mockResolvedValue(undefined),
    getDefault: vi.fn().mockResolvedValue({ id: 1, name: 'Unsorted', is_default: 1, position: -1 }),
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
  pi: {
    listExtensions: vi.fn().mockResolvedValue([]),
    sessionStats: vi.fn().mockResolvedValue({ stats: null, contextUsage: null }),
    onUIEvent: vi.fn().mockReturnValue(() => {}),
    onUIRequest: vi.fn().mockReturnValue(() => {}),
    respondUI: vi.fn().mockResolvedValue(undefined),
    sendTuiInput: vi.fn(),
    onTuiRender: vi.fn().mockReturnValue(() => {}),
    onTuiDone: vi.fn().mockReturnValue(() => {}),
  },
  settings: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    getLocked: vi.fn().mockResolvedValue([]),
  },
  themes: {
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue({ filename: 'test.css', name: 'test', isBuiltin: false, css: '' }),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    save: vi.fn().mockResolvedValue(undefined),
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
  tts: {
    speak: vi.fn().mockResolvedValue(undefined),
    speakMessage: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    validate: vi.fn().mockResolvedValue({ provider: null, providerFound: false, playerFound: false, playerPath: '' }),
    detectPlayers: vi.fn().mockResolvedValue([]),
    listSayVoices: vi.fn().mockResolvedValue([]),
    onStateChange: vi.fn().mockImplementation((cb: (state: { speaking: boolean; messageId?: number }) => void) => {
      capturedTtsStateListener = cb
      return () => {}
    }),
    onAudio: vi.fn().mockImplementation((cb: (audio: { data: string; mime: string; messageId: number | null }) => void) => {
      capturedTtsAudioListener = cb
      return () => {}
    }),
  },
  voice: {
    duck: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
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
    onOverlayStopRecording: vi.fn().mockReturnValue(() => {}),
    onConversationsRefresh: vi.fn().mockReturnValue(() => {}),
    onConversationUpdated: vi.fn().mockImplementation((cb: (id: number) => void) => {
      capturedConversationUpdatedListeners.push(cb)
      capturedConversationUpdatedListener = cb
      return () => {}
    }),
    onAutoThemeSwitch: vi.fn().mockReturnValue(() => {}),
    onReconnect: vi.fn().mockImplementation((cb: () => void) => {
      capturedReconnectListener = cb
      return () => {}
    }),
  },
  window: {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
  },
  scheduler: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    toggle: vi.fn().mockResolvedValue(undefined),
    runNow: vi.fn().mockResolvedValue(undefined),
    conversationTasks: vi.fn().mockResolvedValue([]),
    listVariables: vi.fn().mockResolvedValue([]),
    onTaskUpdate: vi.fn().mockReturnValue(() => {}),
  },
  bugReport: {
    getMainErrors: vi.fn().mockResolvedValue([]),
    scrub: vi.fn().mockResolvedValue(''),
    send: vi.fn().mockResolvedValue({ ok: true }),
    onOpenRequest: vi.fn().mockReturnValue(() => {}),
  },
  models: {
    list: vi.fn().mockResolvedValue([]),
    refresh: vi.fn().mockResolvedValue([]),
  },
  commands: {
    list: vi.fn().mockResolvedValue([]),
  },
  macros: {
    load: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  quickChat: {
    getConversationId: vi.fn().mockResolvedValue(1),
    purge: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    setBubbleMode: vi.fn().mockResolvedValue(undefined),
    reregisterShortcuts: vi.fn().mockResolvedValue(undefined),
  },
  openscad: {
    compile: vi.fn().mockResolvedValue({ data: '', warnings: '' }),
    validateConfig: vi.fn().mockResolvedValue({ binaryFound: true, binaryPath: 'openscad', version: '2021.01' }),
    exportStl: vi.fn().mockResolvedValue(null),
  },
  updates: {
    check: vi.fn().mockResolvedValue({ available: false }),
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
    onStatus: vi.fn().mockReturnValue(() => {}),
  },
  server: {
    start: vi.fn().mockResolvedValue({ url: 'http://localhost:0', token: '' }),
    stop: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({ running: false, port: null, url: null, urlHostname: null, lanIp: null, hostname: null, token: null, shortCode: null, accessMode: null, clients: 0, firewallWarning: null }),
    setPassword: vi.fn().mockResolvedValue(undefined),
    clearPassword: vi.fn().mockResolvedValue(undefined),
    isPasswordSet: vi.fn().mockResolvedValue(false),
    getSessionDurationDays: vi.fn().mockResolvedValue(30),
    setSessionDurationDays: vi.fn().mockResolvedValue(undefined),
    getRememberDurationDays: vi.fn().mockResolvedValue(30),
    setRememberDurationDays: vi.fn().mockResolvedValue(undefined),
  },
  discord: {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ connected: false }),
  },
  jupyter: {
    startKernel: vi.fn().mockResolvedValue({ status: 'ok' }),
    executeCell: vi.fn().mockResolvedValue(''),
    interruptKernel: vi.fn().mockResolvedValue(undefined),
    restartKernel: vi.fn().mockResolvedValue(undefined),
    shutdownKernel: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue(null),
    detectJupyter: vi.fn().mockResolvedValue({ found: false, pythonPath: null }),
    onOutput: vi.fn().mockReturnValue(() => {}),
  },
  git: {
    isRepo: vi.fn().mockResolvedValue(false),
    status: vi.fn().mockResolvedValue({ branch: null, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] }),
    logGraph: vi.fn().mockResolvedValue([]),
    commitDetail: vi.fn().mockResolvedValue({ body: '', files: [] }),
    branches: vi.fn().mockResolvedValue([]),
    stashList: vi.fn().mockResolvedValue([]),
    checkout: vi.fn().mockResolvedValue(undefined),
    stashSave: vi.fn().mockResolvedValue(undefined),
    stashPop: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(undefined),
  },
} satisfies AgentAPI

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
