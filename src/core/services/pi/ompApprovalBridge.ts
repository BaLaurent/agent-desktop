// Bridges omp RPC extension-UI requests to the app's existing approval pipeline.
//
// Empirically (omp v16.2.12, `--approval-mode always-ask`), omp surfaces tool
// approvals as an `extension_ui_request` with:
//   { method: "select", title: "Allow tool: <name>\n<details>",
//     options: ["Approve", "Deny"] }
// The host answers { type: "extension_ui_response", id, value: "Approve"|"Deny" }.
// The `ask` tool (AskUserQuestion equivalent) also uses method "select"/"confirm"/
// "input" with a genuine question title. Cosmetic methods (setWidget/setStatus/
// setTitle/notify/set_editor_text/setHeader/setFooter) are fire-and-forget.
//
// This bridge routes approval selects to the renderer's `tool_approval` flow
// (sendChunk → pendingRequests → respondToApproval) — the SAME channel the Claude
// backend uses — and answers omp with the mapped value. Genuine questions route to
// `ask_user`. Everything else is acknowledged/ignored so omp never blocks.

import { randomUUID } from 'node:crypto'
import { resolve as resolvePath } from 'node:path'
import { sendChunk, pendingRequests } from '../streaming'
import { emitPIUIEvent, emitPIUIRequest } from './piUIChannel'
import { shouldRequireApproval, type PermissionMode } from '../guards/permissionPolicy'
import { isPathOutsideWriteAllowed } from '../guards/cwdGuard'
import { createLogger } from '../../utils/logger'
import type { OmpRpcClient, OmpExtensionUIRequest } from './ompRpcClient'
import type { ToolApprovalResponse, AskUserResponse, CwdWhitelistEntry } from '../../types/types'
import type { PiUIEvent, PiUIResponse } from '../../types/piUITypes'

const log = createLogger('pi.ompApprovalBridge')

/** omp approval-select markers. */
const APPROVE = 'Approve'
const DENY = 'Deny'

function str(frame: Record<string, unknown>, key: string): string | undefined {
  const v = frame[key]
  return typeof v === 'string' ? v : undefined
}

/** Extract a string[] field (e.g. widget content lines) from an untyped frame. */
function strArray(frame: Record<string, unknown>, key: string): string[] | undefined {
  const v = frame[key]
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is string => typeof x === 'string')
}

function isApprovalSelect(req: OmpExtensionUIRequest): boolean {
  if (req.method !== 'select') return false
  const options = req.options
  const title = str(req, 'title') ?? ''
  const isApproveDeny = Array.isArray(options) && options.includes(APPROVE) && options.includes(DENY)
  return isApproveDeny || title.startsWith('Allow tool:')
}

/** Parse the tool name out of an "Allow tool: <name>\n…" title. */
function parseToolName(title: string): string {
  const firstLine = title.split('\n', 1)[0] ?? ''
  const m = firstLine.match(/^Allow tool:\s*(.+)$/)
  return m ? m[1].trim() : 'tool'
}

/** Parse the `Path: <p>` line omp adds to write/edit approval titles. */
function parsePathFromTitle(title: string): string | undefined {
  const m = title.match(/^Path:\s*(.+)$/m)
  return m ? m[1].trim() : undefined
}

const VALID_PERMISSION_MODES: Record<PermissionMode, true> = {
  bypassPermissions: true, acceptEdits: true, default: true, dontAsk: true, plan: true,
}

/** Narrow a free-form permissionMode string to the policy union (default fallback). */
function coercePermissionMode(mode: string | undefined): PermissionMode {
  return mode !== undefined && mode in VALID_PERMISSION_MODES
    ? (mode as PermissionMode)
    : 'default'
}

// Per-conversation "don't ask again for this tool" cache. Module-level,
// process-lifetime, keyed by convKey → set of (lowercased) tool names. Matches
// Claude Code's "always allow this tool" affordance; not persisted across
// restarts (session semantics).
const dontAskCache = new Map<string | number, Set<string>>()

/** Clear the dontAsk approval cache (tests). */
export function clearOmpDontAskCache(): void {
  dontAskCache.clear()
}

export interface OmpApprovalBridgeOptions {
  client: OmpRpcClient
  /** Conversation id for scoping pending requests + chunk payloads. */
  convKey: string | number
  convExtra: Record<string, string | number>
  /** Current permission mode (drives plan-deny + mode auto-decisions). */
  permissionMode?: string
  /** Working directory — the cwd-boundary check anchor for write/edit. */
  cwd?: string
  /** When true, enforce the cwd write/edit boundary (best-effort, path-parsed). */
  cwdRestrictionEnabled?: boolean
  /** Additional read/readwrite dirs beyond cwd. */
  cwdWhitelist?: CwdWhitelistEntry[]
}

/**
 * Attach the approval bridge to an OmpRpcClient. Returns an unsubscribe fn.
 *
 * Approval selects → renderer `tool_approval`; genuine questions → `ask_user`;
 * cosmetic/unsupported UI methods are acknowledged so omp never hangs.
 */
export function attachOmpApprovalBridge(opts: OmpApprovalBridgeOptions): () => void {
  const { client, convKey, convExtra, permissionMode, cwd, cwdRestrictionEnabled, cwdWhitelist } = opts

  return client.onExtensionUI((req) => {
    void handleRequest(req)
  })

  async function handleRequest(req: OmpExtensionUIRequest): Promise<void> {
    try {
      if (isApprovalSelect(req)) {
        await handleApproval(req)
        return
      }
      switch (req.method) {
        case 'select':
        case 'input':
        case 'confirm':
          await handleQuestion(req)
          return
        case 'notify': {
          const message = str(req, 'message')
          if (message) {
            const level = str(req, 'level')
            const evt: PiUIEvent = { method: 'notify', message, level: level === 'warning' || level === 'error' ? level : 'info' }
            emitPIUIEvent(evt)
          }
          return // fire-and-forget, no response
        }
        case 'setStatus': {
          const key = str(req, 'key')
          if (key) emitPIUIEvent({ method: 'setStatus', key, text: str(req, 'text') })
          return
        }
        case 'setWidget': {
          const key = str(req, 'key')
          if (key) {
            const placement = str(req, 'placement')
            emitPIUIEvent({
              method: 'setWidget',
              key,
              content: strArray(req, 'content'),
              placement: placement === 'aboveEditor' ? 'aboveEditor' : 'belowEditor',
            })
          }
          return
        }
        case 'setTitle': {
          const title = str(req, 'title')
          if (title) emitPIUIEvent({ method: 'setTitle', title })
          return
        }
        case 'set_editor_text':
        case 'cancel':
          return // no renderer surface / fire-and-forget — no response expected
        case 'editor':
          handleEditor(req)
          return
        default:
          // open_url and any future method: acknowledge as cancelled to avoid a hang.
          client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, cancelled: true })
          return
      }
    } catch (err) {
      log.warn('approval bridge failed; denying/cancelling', { err: err instanceof Error ? err.message : String(err) })
      client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, cancelled: true })
    }
  }

  /**
   * Route an omp approval-select to the renderer's tool_approval flow — after a
   * host-side policy pass that mirrors the Claude backend (plan-mode deny,
   * cwd write/edit boundary, dontAsk cache, mode auto-decision). Only a genuine
   * `ask` decision surfaces to the user.
   */
  async function handleApproval(req: OmpExtensionUIRequest): Promise<void> {
    const title = str(req, 'title') ?? ''
    const toolName = parseToolName(title)
    const tool = toolName.toLowerCase()

    const respond = (allow: boolean) =>
      client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, value: allow ? APPROVE : DENY })

    // 1. exit_plan_mode escape hatch — the tool itself drives the plan UI.
    if (tool === 'exit_plan_mode') {
      respond(true)
      return
    }

    const mode = coercePermissionMode(permissionMode)

    // 2. Plan-mode deny for mutating tools — steer the model to exit_plan_mode.
    if (mode === 'plan' && shouldRequireApproval(tool, 'plan') === 'deny') {
      respond(false)
      sendChunk('system_message',
        'Blocked in plan mode: present your plan via exit_plan_mode instead of modifying anything.',
        { hookName: 'plan', hookEvent: 'blocked', ...convExtra })
      return
    }

    // 3. cwd write/edit boundary (best-effort — parsed from the approval title).
    if (cwdRestrictionEnabled && cwd && (tool === 'write' || tool === 'edit')) {
      const p = parsePathFromTitle(title)
      if (p !== undefined && isPathOutsideWriteAllowed(resolvePath(cwd, p), cwd, cwdWhitelist ?? []) !== null) {
        respond(false)
        sendChunk('system_message', 'Blocked: path outside the allowed working directory.',
          { hookName: 'cwd', hookEvent: 'blocked', ...convExtra })
        return
      }
      // p undefined (parse failure) → fall through to the mode decision (fail-safe).
    }

    // 4. dontAsk cache hit — user previously chose "don't ask again" for this tool.
    if (dontAskCache.get(convKey)?.has(tool)) {
      respond(true)
      return
    }

    // 5. Mode auto-decision (preserves bypass/yolo/acceptEdits UX even though the
    //    overlay forced omp to prompt for write/edit).
    const decision = shouldRequireApproval(tool, mode)
    if (decision === 'allow') {
      respond(true)
      return
    }
    if (decision === 'deny') {
      respond(false)
      return
    }

    // 6. Surface to the user (decision === 'ask').
    const requestId = randomUUID()
    // Register the pending resolver BEFORE emitting the chunk so a synchronous
    // responder (tests, or a fast in-process transport) can never race ahead of
    // the map insertion and drop the answer.
    const { promise, resolve } = Promise.withResolvers<unknown>()
    pendingRequests.set(requestId, { resolve, conversationId: convKey })
    sendChunk('tool_approval', undefined, {
      requestId,
      toolName,
      // The title carries the full tool+args detail omp rendered; pass it as the
      // input blob so the renderer can show what is being approved.
      toolInput: JSON.stringify({ detail: title }),
      ...convExtra,
    })
    const response = await promise

    const approval = response as ToolApprovalResponse
    const allow = approval?.behavior === 'allow'
    if (allow && approval?.dontAskAgain) {
      const set = dontAskCache.get(convKey) ?? new Set<string>()
      set.add(tool)
      dontAskCache.set(convKey, set)
    }
    respond(allow)
  }

  /** Route a genuine question (ask tool) to the renderer's ask_user flow. */
  async function handleQuestion(req: OmpExtensionUIRequest): Promise<void> {
    const title = str(req, 'title') ?? ''
    const options = Array.isArray(req.options) ? req.options.filter((o): o is string => typeof o === 'string') : []
    const requestId = randomUUID()

    // Represent as a single-question AskUserQuestion for the renderer.
    const questions = [{
      question: title,
      header: title.slice(0, 60),
      options: options.map((label) => ({ label })),
    }]
    // Register the resolver before emitting the chunk (see handleApproval).
    const { promise, resolve } = Promise.withResolvers<unknown>()
    pendingRequests.set(requestId, { resolve, conversationId: convKey })
    sendChunk('ask_user', undefined, { requestId, questions: JSON.stringify(questions), ...convExtra })
    const response = await promise

    const ask = response as AskUserResponse & { message?: string }
    if (!ask?.answers) {
      // Cancellation / no answer → cancel the omp request.
      client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, cancelled: true })
      return
    }
    // Take the single answer (keyed by index "0", the question text, or header).
    const answer = ask.answers['0'] ?? ask.answers[title] ?? Object.values(ask.answers)[0] ?? ''
    if (req.method === 'confirm') {
      const confirmed = /^(y|yes|approve|confirm|true|ok)$/i.test(answer.trim())
      client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, confirmed })
    } else {
      client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, value: answer })
    }
  }

  /** Route an omp `editor` request to the renderer's ExtensionDialog (editor mode). */
  function handleEditor(req: OmpExtensionUIRequest): void {
    const title = str(req, 'title') ?? 'Edit'
    const prefill = str(req, 'prefill')
    // Use omp's own request id as the dialog id — a clean 1:1 so the renderer's
    // response routes straight back to this responder.
    emitPIUIRequest(
      { id: req.id, method: 'editor', title, ...(prefill !== undefined ? { prefill } : {}) },
      (response: PiUIResponse) => {
        if (response.cancelled || typeof response.value !== 'string') {
          client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, cancelled: true })
        } else {
          client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, value: response.value })
        }
      },
    )
  }
}
