import type {
  Conversation,
  ConversationWithMessages,
  Message,
  Folder,
  FileNode,
  McpServer,
  McpServerConfig,
  McpTestResult,
  AllowedTool,
  KnowledgeCollection,
  ThemeFile,
  KeyboardShortcut,
  SlashCommand,
  Macro,
  StreamChunk,
  Attachment,
  AuthStatus,
  SystemInfo,
  SystemLogEntry,
  ToolApprovalResponse,
  AskUserResponse,
  UpdateInfo,
  UpdateStatus,
  ScheduledTask,
  CreateScheduledTask,
  JupyterOutputChunk,
  VariableInfo,
} from '../shared/types'
import type { PIExtensionInfo } from '../shared/constants'
import type { PiUIEvent, PiUIRequest, PiUIResponse } from '../shared/piUITypes'
import type { GitStatus, GitCommit, GitCommitFile, GitBranch, GitStashEntry } from '../shared/git-types'

export type HotwordTrainEvent =
  | { kind: 'log'; message: string }
  | { kind: 'progress'; pct: number; message: string }
  | { kind: 'done'; slug: string; modelPath: string }
  | { kind: 'error'; message: string }
  | { kind: 'setup-done' }

export interface AgentAPI {
  auth: {
    getStatus(): Promise<AuthStatus>
    login(): Promise<AuthStatus>
    logout(): Promise<void>
  }
  bugReport: {
    getMainErrors(): Promise<
      Array<{ timestamp: string; source: 'main' | 'renderer'; level: 'error'; message: string }>
    >
    scrub(text: string): Promise<string>
    send(payload: { description: string; logs: string }): Promise<
      | { ok: true }
      | { ok: false; error: 'not_configured' | 'timeout' | 'invalid_webhook' | 'server_error' | 'unknown' }
      | { ok: false; error: 'rate_limited'; retryAfterMs: number }
    >
    onOpenRequest(cb: () => void): () => void
  }
  models: {
    list(backend?: string): Promise<{ value: string; label: string }[]>
    refresh(backend?: string): Promise<{ value: string; label: string }[]>
  }
  conversations: {
    list(): Promise<Conversation[]>
    get(id: number): Promise<ConversationWithMessages>
    markOpened(id: number): Promise<void>
    create(title?: string, folderId?: number): Promise<Conversation>
    update(id: number, data: Partial<Conversation>): Promise<void>
    delete(id: number): Promise<void>
    deleteMany(ids: number[]): Promise<void>
    moveMany(ids: number[], folderId: number | null): Promise<void>
    colorMany(ids: number[], color: string | null): Promise<void>
    export(id: number, format: 'markdown' | 'json'): Promise<string>
    import(data: string): Promise<Conversation>
    search(query: string): Promise<Conversation[]>
    generateTitle(id: number): Promise<void>
    fork(conversationId: number, messageId: number): Promise<Conversation>
  }
  messages: {
    send(conversationId: number, content: string, attachments?: Attachment[]): Promise<Message | null>
    compact(conversationId: number): Promise<{ summary: string; clearedAt: string }>
    stop(conversationId?: number): Promise<void>
    regenerate(conversationId: number): Promise<void>
    edit(messageId: number, content: string): Promise<void>
    respondToApproval(requestId: string, response: ToolApprovalResponse | AskUserResponse): Promise<void>
    onStream(callback: (chunk: StreamChunk) => void): () => void
  }
  context: {
    getBreakdown(conversationId: number): Promise<import('../core/services/contextBreakdown').ContextBreakdown>
    getSkillsOverhead(cwd?: string): Promise<Record<'off' | 'user' | 'project' | 'local', { tokens: number; count: number }>>
  }
  files: {
    listTree(basePath: string, excludePatterns?: string[]): Promise<FileNode[]>
    listDir(dirPath: string): Promise<FileNode[]>
    readFile(filePath: string): Promise<{ content: string; language: string | null; warning?: string }>
    writeFile(filePath: string, content: string): Promise<void>
    savePastedFile(data: Uint8Array, mimeType: string): Promise<string>
    revealInFileManager(filePath: string): Promise<void>
    openTerminalHere(filePath: string): Promise<void>
    openWithDefault(filePath: string): Promise<void>
    trash(filePath: string): Promise<void>
    rename(filePath: string, newName: string): Promise<string>
    duplicate(filePath: string): Promise<string>
    move(sourcePath: string, destDir: string): Promise<string>
    createFile(dirPath: string, name: string): Promise<string>
    createFolder(dirPath: string, name: string): Promise<string>
    prepareSession(conversationId: number, sourcePaths: string[], method: 'copy' | 'symlink', renames?: Record<string, string>): Promise<{ cwd: string; count: number }>
  }
  folders: {
    list(): Promise<Folder[]>
    create(name: string, parentId?: number): Promise<Folder>
    update(id: number, data: Partial<Folder>): Promise<void>
    delete(id: number, mode?: 'keep' | 'delete'): Promise<void>
    reorder(ids: number[]): Promise<void>
    getDefault(): Promise<Folder>
  }
  mcp: {
    listServers(): Promise<McpServer[]>
    addServer(config: McpServerConfig): Promise<McpServer>
    updateServer(id: number, config: Partial<McpServerConfig>): Promise<void>
    removeServer(id: number): Promise<void>
    toggleServer(id: number): Promise<void>
    testConnection(id: number): Promise<McpTestResult>
  }
  tools: {
    listAvailable(): Promise<AllowedTool[]>
    setEnabled(value: string): Promise<void>
    toggle(toolName: string): Promise<void>
  }
  kb: {
    listCollections(): Promise<KnowledgeCollection[]>
    getCollectionFiles(collectionName: string): Promise<{ name: string; path: string; size: number }[]>
    openKnowledgesFolder(): Promise<void>
  }
  pi: {
    listExtensions(): Promise<PIExtensionInfo[]>
    onUIEvent(callback: (event: PiUIEvent) => void): () => void
    onUIRequest(callback: (request: PiUIRequest) => void): () => void
    respondUI(id: string, response: PiUIResponse): void
    sendTuiInput(id: string, data: string): void
    onTuiRender(callback: (payload: { id: string; html: string }) => void): () => void
    onTuiDone(callback: (payload: { id: string }) => void): () => void
  }
  settings: {
    get(): Promise<Record<string, string>>
    set(key: string, value: string): Promise<void>
    getLocked(): Promise<string[]>
  }
  themes: {
    list(): Promise<ThemeFile[]>
    read(filename: string): Promise<ThemeFile>
    create(filename: string, css: string): Promise<ThemeFile>
    save(filename: string, css: string): Promise<void>
    delete(filename: string): Promise<void>
    getDir(): Promise<string>
    refresh(): Promise<ThemeFile[]>
  }
  commands: {
    list(cwd?: string, skillsMode?: string): Promise<SlashCommand[]>
  }
  macros: {
    load(name: string): Promise<string[] | null>
    list(): Promise<Macro[]>
    save(name: string, description: string, messages: string[], oldName?: string): Promise<void>
    delete(name: string): Promise<void>
  }
  quickChat: {
    getConversationId(mode?: 'text' | 'voice'): Promise<number>
    purge(): Promise<void>
    hide(): Promise<void>
    setBubbleMode(): Promise<void>
    reregisterShortcuts(): Promise<void>
  }
  shortcuts: {
    list(): Promise<KeyboardShortcut[]>
    update(id: number, keybinding: string): Promise<void>
  }
  whisper: {
    transcribe(wavBuffer: Uint8Array): Promise<{ text: string }>
    validateConfig(): Promise<{ binaryFound: boolean; modelFound: boolean; binaryPath: string; modelPath: string }>
  }
  sherpa: {
    transcribe(wavBuffer: Uint8Array): Promise<{ text: string }>
    validateConfig(): Promise<{ modelPath: string; files: string[]; detected: 'transducer' | 'whisper' | 'paraformer' | 'nemoCtc' | null; ok: boolean; detail?: string }>
    downloadModel(presetId: string): Promise<{ modelPath: string }>
    listInstalledModels(): Promise<{ id: string; dir: string }[]>
    onDownloadProgress(cb: (p: { file: string; index: number; total: number }) => void): () => void
  }
  voice: {
    duck(): Promise<void>
    restore(): Promise<void>
  }
  voiceIntent: {
    classify(conversationId: number, text: string): Promise<{ addressed: boolean }>
  }
  hotwordTrain: {
    listModels(): Promise<{ slug: string; path: string }[]>
    start(phrase: string): Promise<{ started: boolean }>
    setup(): Promise<{ started: boolean }>
    cancel(): Promise<{ cancelled: boolean }>
    status(): Promise<{ running: boolean; phrase: string | null }>
    onEvent(callback: (ev: HotwordTrainEvent) => void): () => void
  }
  tts: {
    speak(text: string): Promise<void>
    speakMessage(text: string, conversationId: number, messageId: number): Promise<void>
    stop(): Promise<void>
    validate(): Promise<{ provider: string | null; providerFound: boolean; playerFound: boolean; playerPath: string; error?: string }>
    detectPlayers(): Promise<Array<{ name: string; path: string; available: boolean }>>
    listSayVoices(): Promise<Array<{ name: string; locale: string }>>
    onStateChange(callback: (state: { speaking: boolean; messageId?: number }) => void): () => void
  }
  openscad: {
    compile(scadFilePath: string): Promise<{ data: string; warnings: string }>
    validateConfig(): Promise<{ binaryFound: boolean; binaryPath: string; version: string }>
    exportStl(scadFilePath: string): Promise<string | null>
  }
  scheduler: {
    list(): Promise<ScheduledTask[]>
    get(id: number): Promise<ScheduledTask | null>
    create(data: CreateScheduledTask): Promise<ScheduledTask>
    update(id: number, data: Partial<CreateScheduledTask>): Promise<void>
    delete(id: number): Promise<void>
    toggle(id: number, enabled: boolean): Promise<void>
    runNow(id: number): Promise<void>
    conversationTasks(conversationId: number): Promise<number[]>
    listVariables(): Promise<VariableInfo[]>
    onTaskUpdate(callback: (task: ScheduledTask) => void): () => void
  }
  updates: {
    check(): Promise<UpdateInfo>
    download(): Promise<void>
    install(): Promise<void>
    getStatus(): Promise<UpdateStatus>
    onStatus(callback: (status: UpdateStatus) => void): () => void
  }
  server: {
    start(port?: number, options?: { shortCode?: string; accessMode?: string }): Promise<{ url: string; token: string }>
    stop(): Promise<void>
    getStatus(): Promise<{ running: boolean; port: number | null; url: string | null; urlHostname: string | null; lanIp: string | null; hostname: string | null; token: string | null; shortCode: string | null; accessMode: string | null; clients: number; firewallWarning: string | null }>
    setPassword(plaintext: string): Promise<void>
    clearPassword(): Promise<void>
    isPasswordSet(): Promise<boolean>
    getSessionDurationDays(): Promise<number>
    setSessionDurationDays(days: number): Promise<void>
    getRememberDurationDays(): Promise<number>
    setRememberDurationDays(days: number): Promise<void>
  }
  discord: {
    connect(): Promise<void>
    disconnect(): Promise<void>
    status(): Promise<{ connected: boolean; username?: string; guildCount?: number }>
  }
  jupyter: {
    startKernel(filePath: string, kernelName?: string): Promise<{ status: string }>
    executeCell(filePath: string, code: string): Promise<string>
    interruptKernel(filePath: string): Promise<void>
    restartKernel(filePath: string): Promise<void>
    shutdownKernel(filePath: string): Promise<void>
    getStatus(filePath: string): Promise<string | null>
    detectJupyter(): Promise<{ found: boolean; pythonPath: string | null; error?: string }>
    onOutput(callback: (chunk: JupyterOutputChunk) => void): () => void
  }
  system: {
    getPathForFile(file: File): string
    getInfo(): Promise<SystemInfo>
    getLogs(limit?: number): Promise<SystemLogEntry[]>
    clearCache(): Promise<void>
    openExternal(url: string): Promise<void>
    selectFolder(): Promise<string | null>
    selectFile(): Promise<string | null>
    showNotification(title: string, body: string): Promise<void>
    purgeConversations(): Promise<{ conversations: number; folders: number }>
    purgeAll(): Promise<{ conversations: number }>
  }
  events: {
    onTrayNewConversation(callback: () => void): () => void
    onDeeplinkNavigate(callback: (conversationId: number) => void): () => void
    onConversationTitleUpdated(callback: (data: { id: number; title: string }) => void): () => void
    onOverlayStopRecording(callback: () => void): () => void
    onConversationsRefresh(callback: () => void): () => void
    onConversationUpdated(callback: (conversationId: number) => void): () => void
    onAutoThemeSwitch(callback: (filename: string) => void): () => void
    /**
     * Fires after the transport reconnects following a drop. Only the web
     * WebSocket shim emits this; Electron's IPC bridge never disconnects, so
     * its implementation is an inert no-op. Renderer code uses it to re-pull
     * authoritative state that may have changed during the offline window.
     */
    onReconnect(callback: () => void): () => void
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  git: {
    isRepo(cwd: string | null): Promise<boolean>
    status(cwd: string): Promise<GitStatus>
    logGraph(cwd: string, opts?: { limit?: number; branch?: string }): Promise<GitCommit[]>
    commitDetail(cwd: string, sha: string): Promise<{ body: string; files: GitCommitFile[] }>
    branches(cwd: string): Promise<GitBranch[]>
    stashList(cwd: string): Promise<GitStashEntry[]>
    checkout(cwd: string, name: string): Promise<void>
    stashSave(cwd: string, message?: string): Promise<void>
    stashPop(cwd: string, index: number): Promise<void>
    fetch(cwd: string, remote?: string): Promise<void>
  }
}

declare global {
  interface Window {
    agent: AgentAPI
  }
}
