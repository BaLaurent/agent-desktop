// One-shot omp RPC helper: run a single prompt with no tools, no session, and
// return the assistant's text. Used by summarization (compaction + auto-title)
// for non-Claude models. Mirrors the former summarizePI (in-memory, zero tools)
// but drives the omp subprocess instead of the in-process SDK.

import { findOmpBinary } from './ompLocator'
import { OmpRpcClient } from './ompRpcClient'
import { createLogger } from '../../utils/logger'

const log = createLogger('pi.ompOneShot')

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export interface OmpOneShotOptions {
  cwd: string
  /** Model id/pattern passed to omp `--model` (fuzzy or provider/id). */
  model?: string
  /** Overall timeout for the turn in ms (default 120s). */
  timeoutMs?: number
}

/**
 * Run a single non-interactive omp turn and return the trimmed assistant text.
 * Throws if the omp binary is unavailable.
 */
export async function runOmpOneShot(prompt: string, opts: OmpOneShotOptions): Promise<string> {
  const ompPath = findOmpBinary()
  if (!ompPath) {
    throw new Error('omp binary not found. Install Oh My Pi or set PI_OMP_PATH.')
  }

  const client = new OmpRpcClient({
    ompPath,
    cwd: opts.cwd,
    model: opts.model,
    // No tools, no session, auto-approve (there are no tools to approve anyway).
    args: ['--no-tools', '--no-session', '--thinking', 'off', '--approval-mode', 'yolo'],
  })

  let text = ''
  try {
    await client.start()
    const unsubscribe = client.onEvent((frame) => {
      if (frame.type !== 'message_update') return
      const ame = frame.assistantMessageEvent
      if (!isRecord(ame)) return
      if (ame.type === 'text_delta' && typeof ame.delta === 'string') text += ame.delta
    })
    try {
      const agentEnd = client.waitForAgentEnd(opts.timeoutMs ?? 120_000)
      await client.prompt(prompt)
      await agentEnd
    } finally {
      unsubscribe()
    }
  } catch (err) {
    log.warn('omp one-shot failed', { err: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    client.stop()
  }

  return text.trim()
}
