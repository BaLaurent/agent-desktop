// ─── Database Row Types ───────────────────────────────────────

export interface AIOverrides {
  ai_model?: string
  ai_maxTurns?: string
  ai_maxThinkingTokens?: string
  ai_maxBudgetUsd?: string
  ai_permissionMode?: string
  ai_tools?: string
  ai_defaultSystemPrompt?: string
  ai_mcpDisabled?: string
  ai_knowledgeFolders?: string
  ai_skills?: string
  hooks_cwdRestriction?: string
  files_excludePatterns?: string
}

export interface Conversation {
  id: number
  title: string
  folder_id: number | null
  position: number
  model: string
  system_prompt: string | null
  cwd: string | null
  kb_enabled: number // 0 or 1 (SQLite boolean)
  ai_overrides: string | null // JSON AIOverrides
  created_at: string
  updated_at: string
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[]
}

export interface Message {
  id: number
  conversation_id: number
  role: 'user' | 'assistant'
  content: string
  attachments: string // JSON array
  tool_calls: string | null // JSON ToolCall[] or null
  created_at: string
  updated_at: string
}

export interface Folder {
  id: number
  name: string
  parent_id: number | null
  position: number
  ai_overrides: string | null // JSON AIOverrides
  default_cwd: string | null
  created_at: string
  updated_at: string
}

export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
}

export type McpTransportType = 'stdio' | 'http' | 'sse'

export interface McpServer {
  id: number
  name: string
  type: McpTransportType
  command: string
  args: string // JSON array
  env: string // JSON object
  url: string | null
  headers: string // JSON object
  enabled: number
  status: 'configured' | 'disabled' | 'error'
  created_at: string
  updated_at: string
}

export interface McpServerConfig {
  name: string
  type?: McpTransportType
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export type McpServerSDKConfig =
  | { command: string; args: string[]; env?: Record<string, string> }
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }

export interface McpTestResult {
  success: boolean
  output: string
}

export interface AllowedTool {
  name: string
  description: string
  enabled: boolean
}

export interface KnowledgeFile {
  id: number
  path: string
  name: string
  content_hash: string
  size: number
  created_at: string
  updated_at: string
}

export interface KnowledgeCollection {
  name: string          // folder name (relative to knowledges root)
  path: string          // absolute path
  fileCount: number     // supported files found recursively
  totalSize: number     // cumulative bytes
}

export interface KnowledgeSelection {
  folder: string              // collection name
  access: 'read' | 'readwrite'
}

export interface ThemeFile {
  filename: string
  name: string
  isBuiltin: boolean
  css: string
}

export interface KeyboardShortcut {
  id: number
  action: string
  keybinding: string
  enabled: number
  created_at: string
  updated_at: string
}

// ─── Tool Approval / AskUserQuestion Types ───────────────────

export interface AskUserOption {
  label: string
  description: string
}

export interface AskUserQuestion {
  question: string
  header: string
  options: AskUserOption[]
  multiSelect: boolean
}

export interface ToolApprovalResponse {
  behavior: 'allow' | 'deny'
  message?: string
}

export interface AskUserResponse {
  answers: Record<string, string>
}

// ─── Tool Call Persistence ────────────────────────────────────

export interface ToolCall {
  id: string        // tool_use_id from SDK
  name: string      // e.g. "Bash", "Read", "Edit"
  input: string     // JSON string of input params
  output: string    // full tool result content
  status: 'done' | 'error'
}

// ─── MCP Connection Status ───────────────────────────────────

export interface McpConnectionStatus {
  name: string
  status: 'connected' | 'error' | 'connecting'
  error?: string
}

// ─── Notification Types ─────────────────────────────────────

export type NotificationEvent =
  | 'success'
  | 'max_tokens'
  | 'refusal'
  | 'error_max_turns'
  | 'error_max_budget'
  | 'error_execution'
  | 'error_js'

export interface NotificationEventConfig {
  sound: boolean
  desktop: boolean
}

export type NotificationConfig = Record<NotificationEvent, NotificationEventConfig>

// ─── IPC / Runtime Types ──────────────────────────────────────

export interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_input' | 'tool_result' | 'tool_approval' | 'ask_user' | 'mcp_status' | 'error' | 'done'
  content?: string
  toolName?: string
  toolId?: string
  toolOutput?: string
  requestId?: string
  toolInput?: string
  questions?: string
  mcpServers?: string  // JSON McpConnectionStatus[]
  conversationId?: number
  stopReason?: string
  resultSubtype?: string
}

export type StreamPart =
  | { type: 'text'; content: string }
  | { type: 'tool'; name: string; id: string; status: 'running' | 'done'; summary?: string; input?: Record<string, unknown>; output?: string }
  | { type: 'tool_approval'; requestId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'ask_user'; requestId: string; questions: AskUserQuestion[] }
  | { type: 'mcp_status'; servers: McpConnectionStatus[] }

export interface Attachment {
  name: string
  path: string
  type: string
  size: number
}

export interface AuthDiagnostics {
  claudeBinaryFound: boolean
  claudeBinaryPath: string | null
  credentialsFileExists: boolean
  configDir: string
  isAppImage: boolean
  home: string
  ldLibraryPath?: string
  sdkError?: string
}

export interface AuthStatus {
  authenticated: boolean
  user: { email: string; name: string } | null
  error?: string
  diagnostics?: AuthDiagnostics
}

export interface SystemInfo {
  version: string
  electron: string
  node: string
  platform: string
  dbPath: string
  configPath: string
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
  details?: string
}

