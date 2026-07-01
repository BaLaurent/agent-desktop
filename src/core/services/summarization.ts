import { loadAgentSDK } from './anthropic'
import { runOmpOneShot } from './pi/ompOneShot'

export interface SummarizeOptions {
  /** Working directory passed to the underlying SDK. */
  cwd: string
  /** Optional API key override. Claude path injects into env before calling query(). */
  apiKey?: string
  /** Optional base URL override (Claude path). */
  baseUrl?: string
  /**
   * Force a specific SDK path, bypassing the name-based routing. Needed when a
   * model id doesn't follow the `claude-*` convention but must still go through
   * the Claude Agent SDK (e.g. a local OpenAI/Anthropic-compatible endpoint
   * reached via a custom base URL). Undefined = route by model family.
   */
  backend?: 'claude' | 'pi'
}

/** True if the model id is a Claude family model (routes to Claude SDK). */
// consumed by summarization.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export function isClaudeModel(model: string): boolean {
  return typeof model === 'string' && model.startsWith('claude-')
}

/**
 * Run a one-shot summarization turn with `model` and return the assistant's
 * text output. Routes to the Claude Agent SDK for `claude-*` models, to PI
 * SDK for anything else. Used by conversation compaction and auto-title.
 *
 * Never persists a session. No tools. One turn.
 */
export async function summarizeWithModel(
  prompt: string,
  model: string,
  opts: SummarizeOptions,
): Promise<string> {
  const useClaude = opts.backend ? opts.backend === 'claude' : isClaudeModel(model)
  if (useClaude) {
    return summarizeClaude(prompt, model, opts)
  }
  return summarizePI(prompt, model, opts)
}

async function summarizeClaude(prompt: string, model: string, _opts: SummarizeOptions): Promise<string> {
  const sdk = await loadAgentSDK()
  // Force the Claude Code CLI binary from PATH — see streaming.ts for
  // the musl-vs-glibc rationale.
  const { findBinaryInPath } = await import('../utils/env')
  const claudeExecutable = findBinaryInPath('claude')

  let text = ''
  const agentQuery = sdk.query({
    prompt,
    options: {
      model,
      maxTurns: 1,
      allowDangerouslySkipPermissions: true,
      permissionMode: 'bypassPermissions',
      tools: [],
      persistSession: false,
      ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
    },
  })
  for await (const message of agentQuery) {
    const msg = message as { type: string; subtype?: string; result?: string; message?: { content?: Array<{ type: string; text?: string }> } }
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) text = block.text.trim()
      }
    }
    if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string' && msg.result.trim()) {
      text = msg.result.trim()
    }
  }
  return text
}

async function summarizePI(prompt: string, model: string, opts: SummarizeOptions): Promise<string> {
  // Non-Claude models run through the omp RPC subprocess (Oh My Pi). One-shot:
  // no tools, no session, auto-approve. omp owns auth/model resolution itself.
  return runOmpOneShot(prompt, { cwd: opts.cwd, model })
}
