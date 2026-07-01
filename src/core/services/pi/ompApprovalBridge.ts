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
import { sendChunk, pendingRequests } from '../streaming'
import { createLogger } from '../../utils/logger'
import type { OmpRpcClient, OmpExtensionUIRequest } from './ompRpcClient'
import type { ToolApprovalResponse, AskUserResponse } from '../../types/types'

const log = createLogger('pi.ompApprovalBridge')

/** omp approval-select markers. */
const APPROVE = 'Approve'
const DENY = 'Deny'

function str(frame: Record<string, unknown>, key: string): string | undefined {
  const v = frame[key]
  return typeof v === 'string' ? v : undefined
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

export interface OmpApprovalBridgeOptions {
  client: OmpRpcClient
  /** Conversation id for scoping pending requests + chunk payloads. */
  convKey: string | number
  convExtra: Record<string, string | number>
}

/**
 * Attach the approval bridge to an OmpRpcClient. Returns an unsubscribe fn.
 *
 * Approval selects → renderer `tool_approval`; genuine questions → `ask_user`;
 * cosmetic/unsupported UI methods are acknowledged so omp never hangs.
 */
export function attachOmpApprovalBridge(opts: OmpApprovalBridgeOptions): () => void {
  const { client, convKey, convExtra } = opts

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
          if (message) sendChunk('system_message', message, { hookName: 'omp', hookEvent: 'notify', ...convExtra })
          return // fire-and-forget, no response
        }
        case 'setWidget':
        case 'setStatus':
        case 'setTitle':
        case 'set_editor_text':
        case 'cancel':
          return // cosmetic / fire-and-forget — no response expected
        case 'editor':
          // Editor UI unsupported over this bridge — cancel so omp proceeds.
          client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, cancelled: true })
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

  /** Route an omp approval-select to the renderer's tool_approval flow. */
  async function handleApproval(req: OmpExtensionUIRequest): Promise<void> {
    const title = str(req, 'title') ?? ''
    const toolName = parseToolName(title)
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
    client.respondExtensionUI({ type: 'extension_ui_response', id: req.id, value: allow ? APPROVE : DENY })
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
}
