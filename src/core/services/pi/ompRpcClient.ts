// Node-side JSON-RPC stdio client for Oh My Pi (`omp --mode rpc`).
//
// Oh My Pi (`@oh-my-pi/pi-coding-agent`) is a Bun-only runtime and CANNOT be
// imported in-process under Electron/Node (its published entry is raw `.ts`
// importing `bun`/`bun:sqlite`). The only viable integration is out-of-process:
// spawn the standalone `omp` binary in RPC mode and drive its newline-delimited
// JSON protocol over stdio. This module is a self-contained Node port of omp's
// own `RpcClient` (src/modes/rpc/rpc-client.ts) — no Bun APIs, only node:
// `child_process` + `readline`.
//
// Protocol (see omp src/modes/rpc/rpc-mode.ts):
//  - Server emits `{"type":"ready"}\n` once ready, then one JSON object per line.
//  - Commands are written to stdin as one JSON object per line; optional `id`
//    correlates a `{type:"response",command,success,data|error}` reply.
//  - Session/agent events (`message_update`, `tool_execution_*`, `agent_end`, …)
//    stream as raw `AgentSessionEvent` frames.
//  - Host tools: `set_host_tools` registers host-owned tools; the server then
//    emits `host_tool_call`, the host replies `host_tool_result` (or streams
//    `host_tool_update`), and `host_tool_cancel` aborts a pending call.
//  - Approvals / prompts flow over `extension_ui_request` ↔ `extension_ui_response`.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { createLogger } from '../../utils/logger'

const log = createLogger('ompRpcClient')

// ─── Protocol frame shapes (structural; omp is the source of truth) ──────────

/** A host-owned tool definition sent via `set_host_tools`. `parameters` is a
 *  plain JSON Schema object (TypeBox/Zod both serialize to this on the wire). */
export interface OmpHostToolDefinition {
  name: string
  label: string
  description: string
  parameters: Record<string, unknown>
  hidden?: boolean
}

/** Result payload of a host tool execution (matches omp `AgentToolResult`). */
export interface OmpToolResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>
  details?: unknown
}

export interface OmpHostToolContext {
  toolCallId: string
  signal: AbortSignal
  /** Stream a partial result back to the server (`host_tool_update`). */
  sendUpdate(partial: OmpToolResult | string): void
}

export interface OmpHostTool {
  name: string
  label: string
  description: string
  /** JSON Schema object for the tool parameters. */
  parameters: Record<string, unknown>
  hidden?: boolean
  execute(
    params: Record<string, unknown>,
    ctx: OmpHostToolContext,
  ): Promise<OmpToolResult | string> | OmpToolResult | string
}

/** Extension-UI request emitted by the server (approvals, prompts, notices). */
export interface OmpExtensionUIRequest {
  type: 'extension_ui_request'
  id: string
  method: string
  [k: string]: unknown
}

/** Response the host writes back for an extension-UI request. */
export type OmpExtensionUIResponse =
  | { type: 'extension_ui_response'; id: string; value: string }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean }
  | { type: 'extension_ui_response'; id: string; cancelled: true; timedOut?: boolean }

interface OmpResponseFrame {
  type: 'response'
  id?: string
  command: string
  success: boolean
  data?: unknown
  error?: string
}

export interface OmpRpcClientOptions {
  /** Absolute path to the `omp` binary (standalone ELF; embeds its own runtime). */
  ompPath: string
  /** Working directory for the agent process. */
  cwd?: string
  /** Extra environment variables (merged over `process.env`). */
  env?: Record<string, string | undefined>
  /** `--model` fuzzy pattern or `provider/id`. */
  model?: string
  /** `--session-dir` for session storage/lookup. */
  sessionDir?: string
  /** Additional raw CLI args (e.g. `--no-tools`, `--tools=...`, `--thinking=...`). */
  args?: string[]
  /** Milliseconds to wait for the `ready` frame before failing. */
  readyTimeoutMs?: number
}

type Frame = Record<string, unknown>
type FrameListener = (frame: Frame) => void

const AGENT_EVENT_TYPES = new Set([
  'agent_start', 'agent_end', 'turn_start', 'turn_end',
  'message_start', 'message_update', 'message_end',
  'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function normalizeToolResult(result: OmpToolResult | string): OmpToolResult {
  if (typeof result === 'string') {
    return { content: [{ type: 'text', text: result }] }
  }
  return result
}

/**
 * Resolve a spawnable cwd. `child_process.spawn` throws a MISLEADING `ENOENT`
 * that names the BINARY when the `cwd` option points to a missing directory —
 * so a deleted/moved conversation cwd looks like "omp not found". Fall back to
 * $HOME (then the process cwd) when the requested dir is absent or not a
 * directory. Returns undefined only if nothing valid exists (spawn then uses
 * the process cwd). Undefined input → undefined (spawn uses process cwd).
 */
function resolveSpawnCwd(cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined
  try {
    if (statSync(cwd).isDirectory()) return cwd
  } catch {
    // missing / not accessible — fall through
  }
  log.warn('spawn cwd is not a valid directory; falling back', { cwd })
  const home = homedir()
  try {
    if (statSync(home).isDirectory()) return home
  } catch {
    // no home — last resort below
  }
  return undefined
}

/**
 * Drives an `omp --mode rpc` child process from Node.
 *
 * Lifecycle: `start()` → (`setHostTools`, `onEvent`/`onExtensionUI`, `prompt`,
 * `waitForAgentEnd`) → `stop()`. One instance per turn or per conversation.
 */
export class OmpRpcClient {
  #proc: ChildProcessWithoutNullStreams | null = null
  #rl: Interface | null = null
  #stderr = ''
  #requestSeq = 0
  #pending = new Map<string, { resolve: (f: OmpResponseFrame) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  #hostTools = new Map<string, OmpHostTool>()
  #pendingHostCalls = new Map<string, AbortController>()
  #eventListeners = new Set<FrameListener>()
  #uiListeners = new Set<(req: OmpExtensionUIRequest) => void>()
  #exited = false

  constructor(private readonly options: OmpRpcClientOptions) {}

  /** Collected stderr (diagnostics on failure). */
  get stderr(): string { return this.#stderr }

  /** True once the child process has exited. */
  get exited(): boolean { return this.#exited }

  /** Spawn `omp --mode rpc` and resolve when the `ready` frame arrives. */
  async start(): Promise<void> {
    if (this.#proc) throw new Error('OmpRpcClient already started')

    const args = ['--mode', 'rpc']
    if (this.options.model) args.push('--model', this.options.model)
    if (this.options.sessionDir) args.push('--session-dir', this.options.sessionDir)
    if (this.options.args) args.push(...this.options.args)

    const proc = spawn(this.options.ompPath, args, {
      cwd: resolveSpawnCwd(this.options.cwd),
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#proc = proc

    proc.stderr.on('data', (d: Buffer) => {
      this.#stderr += d.toString()
      if (this.#stderr.length > 64_000) this.#stderr = this.#stderr.slice(-64_000)
    })

    const rl = createInterface({ input: proc.stdout })
    this.#rl = rl

    const { promise: ready, resolve: readyResolve, reject: readyReject } = Promise.withResolvers<void>()
    let readySettled = false

    rl.on('line', (line: string) => {
      if (!line.trim()) return
      let frame: unknown
      try {
        frame = JSON.parse(line)
      } catch {
        log.warn('Unparseable RPC frame', { line: line.slice(0, 200) })
        return
      }
      if (!isRecord(frame)) return
      if (!readySettled && frame.type === 'ready') {
        readySettled = true
        readyResolve()
        return
      }
      this.#handleFrame(frame)
    })

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      this.#exited = true
      const err = new Error(`omp RPC process exited (code=${code}, signal=${signal}). stderr: ${this.#stderr.slice(-800)}`)
      if (!readySettled) {
        readySettled = true
        readyReject(err)
      }
      // Reject any in-flight requests so callers don't hang.
      for (const [id, entry] of this.#pending) {
        clearTimeout(entry.timer)
        entry.reject(err)
        this.#pending.delete(id)
      }
      for (const controller of this.#pendingHostCalls.values()) controller.abort()
      this.#pendingHostCalls.clear()
    }
    proc.on('exit', onExit)
    proc.on('error', (err) => {
      this.#exited = true
      if (!readySettled) {
        readySettled = true
        readyReject(err instanceof Error ? err : new Error(String(err)))
      }
    })

    const timer = setTimeout(() => {
      if (readySettled) return
      readySettled = true
      readyReject(new Error(`Timeout waiting for omp RPC ready. stderr: ${this.#stderr.slice(-800)}`))
    }, this.options.readyTimeoutMs ?? 30_000)
    timer.unref()

    try {
      await ready
    } finally {
      clearTimeout(timer)
    }
  }

  /** Kill the child process and reject all pending work. */
  stop(): void {
    const proc = this.#proc
    if (!proc) return
    this.#proc = null
    try { this.#rl?.close() } catch { /* ignore */ }
    this.#rl = null
    try { proc.stdin.end() } catch { /* ignore */ }
    try { proc.kill('SIGTERM') } catch { /* ignore */ }
    for (const [id, entry] of this.#pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('OmpRpcClient stopped'))
      this.#pending.delete(id)
    }
    for (const controller of this.#pendingHostCalls.values()) controller.abort()
    this.#pendingHostCalls.clear()
  }

  // ─── Event / UI subscription ───────────────────────────────────────────────

  /** Subscribe to raw session/agent event frames. Returns an unsubscribe fn. */
  onEvent(listener: FrameListener): () => void {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  /** Subscribe to `extension_ui_request` frames (approvals, prompts, notices). */
  onExtensionUI(listener: (req: OmpExtensionUIRequest) => void): () => void {
    this.#uiListeners.add(listener)
    return () => this.#uiListeners.delete(listener)
  }

  /** Reply to an `extension_ui_request` (approval / prompt / question). */
  respondExtensionUI(response: OmpExtensionUIResponse): void {
    this.#write(response)
  }

  // ─── Commands ──────────────────────────────────────────────────────────────

  /** Send a prompt. Resolves on the immediate ack; drive completion off `agent_end`. */
  async prompt(message: string, images?: unknown[]): Promise<OmpResponseFrame> {
    return this.#send({ type: 'prompt', message, ...(images ? { images } : {}) })
  }

  /** Inject a steering message into the running turn. */
  async steer(message: string, images?: unknown[]): Promise<OmpResponseFrame> {
    return this.#send({ type: 'steer', message, ...(images ? { images } : {}) })
  }

  /** Abort the current turn. */
  async abort(): Promise<OmpResponseFrame> {
    return this.#send({ type: 'abort' })
  }

  /** Force a compaction pass. */
  async compact(customInstructions?: string): Promise<OmpResponseFrame> {
    return this.#send({ type: 'compact', ...(customInstructions ? { customInstructions } : {}) })
  }

  /** Fetch current session state (`model`, `sessionId`, `sessionFile`, …). */
  async getState(): Promise<OmpResponseFrame> {
    return this.#send({ type: 'get_state' })
  }

  /** Set the active model by provider + id. */
  async setModel(provider: string, modelId: string): Promise<OmpResponseFrame> {
    return this.#send({ type: 'set_model', provider, modelId })
  }

  /** List available models (provider + id + metadata) omp can use. */
  async getAvailableModels(): Promise<OmpResponseFrame> {
    return this.#send({ type: 'get_available_models' })
  }

  /** List all slash commands omp discovers (builtin + skills + extensions + files + custom). */
  async getAvailableCommands(): Promise<OmpResponseFrame> {
    return this.#send({ type: 'get_available_commands' })
  }

  /** Fetch session stats (message counts, token usage, cost). */
  async getSessionStats(): Promise<OmpResponseFrame> {
    return this.#send({ type: 'get_session_stats' })
  }

  /**
   * Register the host-owned tools omp may call back into. Replaces any prior set.
   * The server responds with the accepted tool names.
   */
  async setHostTools(tools: OmpHostTool[]): Promise<string[]> {
    this.#hostTools = new Map(tools.map((t) => [t.name, t]))
    const definitions: OmpHostToolDefinition[] = tools.map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
      parameters: t.parameters,
      ...(t.hidden !== undefined ? { hidden: t.hidden } : {}),
    }))
    const resp = await this.#send({ type: 'set_host_tools', tools: definitions })
    const data = resp.data as { toolNames?: string[] } | undefined
    return data?.toolNames ?? []
  }

  /** Resolve once an `agent_end` frame arrives (turn complete). */
  waitForAgentEnd(timeoutMs = 0): Promise<Frame> {
    const { promise, resolve, reject } = Promise.withResolvers<Frame>()
    let settled = false
    const unsubscribe = this.onEvent((frame) => {
      if (frame.type === 'agent_end') {
        settled = true
        unsubscribe()
        if (timer) clearTimeout(timer)
        resolve(frame)
      }
    })
    let timer: NodeJS.Timeout | undefined
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return
        settled = true
        unsubscribe()
        reject(new Error(`Timeout waiting for agent_end. stderr: ${this.#stderr.slice(-800)}`))
      }, timeoutMs)
      timer.unref()
    }
    return promise
  }

  /**
   * Resolve when the turn ends by EITHER route: an `agent_end` frame (an agent
   * turn ran) OR a `prompt_result` frame (a prompt accepted async that later
   * resolved local-only, e.g. a slash command). Local-only prompts that resolve
   * SYNCHRONOUSLY signal via the `prompt` response's `data.agentInvoked:false` —
   * the caller must handle that case; this waiter covers the two streamed routes.
   */
  waitForTurnEnd(timeoutMs = 0): Promise<Frame> {
    const { promise, resolve, reject } = Promise.withResolvers<Frame>()
    let settled = false
    const unsubscribe = this.onEvent((frame) => {
      if (frame.type === 'agent_end' || frame.type === 'prompt_result') {
        settled = true
        unsubscribe()
        clearTimeout(timer)
        resolve(frame)
      }
    })
    let timer: NodeJS.Timeout | undefined
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return
        settled = true
        unsubscribe()
        reject(new Error(`Timeout waiting for turn end. stderr: ${this.#stderr.slice(-800)}`))
      }, timeoutMs)
      timer.unref()
    }
    return promise
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  #handleFrame(frame: Frame): void {
    // 1. Command response correlation.
    if (frame.type === 'response' && typeof frame.command === 'string') {
      const id = typeof frame.id === 'string' ? frame.id : undefined
      if (id && this.#pending.has(id)) {
        const entry = this.#pending.get(id)!
        clearTimeout(entry.timer)
        this.#pending.delete(id)
        entry.resolve(frame as unknown as OmpResponseFrame)
        return
      }
      // Unmatched responses fall through (e.g. late scheduling errors) — ignore.
      return
    }

    // 2. Host tool call / cancel.
    if (frame.type === 'host_tool_call') {
      void this.#handleHostToolCall(frame)
      return
    }
    if (frame.type === 'host_tool_cancel') {
      const targetId = frame.targetId
      if (typeof targetId === 'string') this.#pendingHostCalls.get(targetId)?.abort()
      return
    }

    // 3. Extension UI requests (approvals / prompts / notices).
    if (frame.type === 'extension_ui_request') {
      for (const listener of this.#uiListeners) listener(frame as unknown as OmpExtensionUIRequest)
      return
    }

    // 4. Session/agent events → subscribers.
    if (typeof frame.type === 'string' && AGENT_EVENT_TYPES.has(frame.type)) {
      for (const listener of this.#eventListeners) listener(frame)
      return
    }
    // Other session-level frames (auto_compaction_*, notice, available_commands_update,
    // etc.) are also forwarded so callers may inspect them if needed.
    for (const listener of this.#eventListeners) listener(frame)
  }

  async #handleHostToolCall(frame: Frame): Promise<void> {
    const id = frame.id as string
    const toolName = frame.toolName as string
    const toolCallId = (frame.toolCallId as string) ?? id
    const args = (frame.arguments as Record<string, unknown>) ?? {}
    const tool = this.#hostTools.get(toolName)

    if (!tool) {
      this.#write({
        type: 'host_tool_result',
        id,
        result: { content: [{ type: 'text', text: `Host tool "${toolName}" is not registered` }], details: {} },
        isError: true,
      })
      return
    }

    const controller = new AbortController()
    this.#pendingHostCalls.set(id, controller)

    const sendUpdate = (partial: OmpToolResult | string): void => {
      if (controller.signal.aborted) return
      this.#write({ type: 'host_tool_update', id, partialResult: normalizeToolResult(partial) })
    }

    try {
      const result = await tool.execute(args, { toolCallId, signal: controller.signal, sendUpdate })
      if (controller.signal.aborted) return
      this.#write({ type: 'host_tool_result', id, result: normalizeToolResult(result) })
    } catch (err) {
      if (controller.signal.aborted) return
      this.#write({
        type: 'host_tool_result',
        id,
        result: { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], details: {} },
        isError: true,
      })
    } finally {
      this.#pendingHostCalls.delete(id)
    }
  }

  #send(command: Record<string, unknown>, timeoutMs = 30_000): Promise<OmpResponseFrame> {
    const id = `req_${++this.#requestSeq}`
    const { promise, resolve, reject } = Promise.withResolvers<OmpResponseFrame>()
    const timer = setTimeout(() => {
      if (!this.#pending.has(id)) return
      this.#pending.delete(id)
      reject(new Error(`Timeout waiting for response to ${String(command.type)}. stderr: ${this.#stderr.slice(-800)}`))
    }, timeoutMs)
    timer.unref()
    this.#pending.set(id, { resolve, reject, timer })
    try {
      this.#write({ ...command, id })
    } catch (err) {
      clearTimeout(timer)
      this.#pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    return promise
  }

  #write(frame: Record<string, unknown>): void {
    const proc = this.#proc
    if (!proc || this.#exited) throw new Error('omp RPC process not running')
    proc.stdin.write(`${JSON.stringify(frame)}\n`)
  }
}
