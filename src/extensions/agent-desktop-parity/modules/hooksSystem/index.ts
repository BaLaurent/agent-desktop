import type { ExtensionAPI, ExtensionRuntimeContext } from '../../shared/types'
import { runHooks, type HookSystemMessage } from '../../../../core/services/hooks/hookRunner'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createLogger, errToCtx } from '../../../../core/utils/logger'

const log = createLogger('hooksSystem')

/**
 * Phase 3 — hooks system adapter.
 *
 * Bridges PI's native event API to the Claude-compatible config-file
 * hook system. Reads `~/.claude/settings.json` (default) or
 * `~/.agent-desktop/hooks.json` (when `sharedHooks === false`), and for
 * each configured hook matching a PI event, execs the command with a
 * JSON-on-stdin payload, parses JSON stdout, and emits systemMessage /
 * enforces decision=deny via the bridge.
 *
 * Plus: fires `aiSettings.webhookCompletionUrl` (if set) on `agent_end`.
 */

// `as never` escapes the strict typing on `pi.on` for events PI has not yet
// added to its public discriminated-union overloads (input, tool_call for the
// narrow generic slot, tool_result, session_start, agent_end). Safe because
// runtime dispatch is string-keyed and our handlers shape the payload
// themselves. Remove the cast when PI SDK exposes typed overloads for these.
const on = <E>(
  pi: ExtensionAPI,
  event: string,
  handler: (event: E, extCtx?: unknown) => unknown,
): void => {
  ;(pi as unknown as { on: (e: string, h: (e: E, c?: unknown) => unknown) => void }).on(event, handler)
}

const SESSION_START_FIRED_KEY = 'hooksSystem.sessionStartFired'

export function initHooksSystem(pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  const cwd = ctx.aiSettings.cwd || process.cwd()
  const sharedHooks = ctx.aiSettings.sharedHooks !== false
  const settingsPath = sharedHooks
    ? join(homedir(), '.claude', 'settings.json')
    : join(homedir(), '.agent-desktop', 'hooks.json')
  const runOpts = { cwd, settingsPath }

  // `msg.content` is empty for deny-only results (decision='deny' with no
  // systemMessage). Those carry no UI text — caller enforces the block
  // from the deny field — so the guard is intentional, not an oversight.
  const emit = (msg: HookSystemMessage): void => {
    if (!msg.content) return
    try {
      ctx.bridge.emitSystemMessage(msg.content, {
        hookName: msg.hookEvent,
        hookEvent: msg.hookEvent,
      })
    } catch (err) {
      // Never propagate bridge failures out of async PI handlers — PI treats
      // a thrown handler as a block, which would produce false denies on
      // UI-layer bugs. Log and continue.
      log.warn('[hooks-system] emit failed', errToCtx(err))
    }
  }

  // UserPromptSubmit — PI's `input` event, user text.
  // Payload matches Claude's shape (session_id, permission_mode) so hook
  // scripts that read these fields from stdin work the same on both paths.
  on<{ text?: string }>(pi, 'input', async (event) => {
    const text = event.text ?? ''
    const results = await runHooks(
      'UserPromptSubmit',
      {
        prompt: text,
        session_id: String(ctx.conversationId),
        permission_mode: ctx.aiSettings.permissionMode ?? 'default',
      },
      runOpts,
    )
    for (const r of results) emit(r)
    return undefined
  })

  // PreToolUse — PI's `tool_call` event; may block.
  on<{ toolName: string; input: Record<string, unknown> }>(pi, 'tool_call', async (event) => {
    const results = await runHooks(
      'PreToolUse',
      { tool_name: event.toolName, tool_input: event.input },
      runOpts,
    )
    for (const r of results) emit(r)
    const deny = results.find(r => r.decision === 'deny')
    if (deny) return { block: true, reason: deny.reason ?? 'Blocked by PreToolUse hook' }
    return undefined
  })

  // PostToolUse — PI's `tool_result` event; emit-only.
  on<{ toolName: string; result: unknown }>(pi, 'tool_result', async (event) => {
    const results = await runHooks(
      'PostToolUse',
      { tool_name: event.toolName, tool_response: event.result },
      runOpts,
    )
    for (const r of results) emit(r)
    return undefined
  })

  // SessionStart — PI fires `session_start` on every session load (every
  // streamMessagePI call), not once per conversation. Guard with
  // sessionStore so the user-defined SessionStart hook runs at most once
  // per conversation lifetime (until /clear or /new resets the store).
  on<{ reason?: string }>(pi, 'session_start', async (event) => {
    if (ctx.sessionStore.get(SESSION_START_FIRED_KEY)) return undefined
    ctx.sessionStore.set(SESSION_START_FIRED_KEY, true)
    const results = await runHooks('SessionStart', { reason: event.reason }, runOpts)
    for (const r of results) emit(r)
    return undefined
  })

  // Stop + webhook — PI's `agent_end` event.
  on<unknown>(pi, 'agent_end', async () => {
    const results = await runHooks('Stop', {}, runOpts)
    for (const r of results) emit(r)

    if (ctx.aiSettings.webhookCompletionUrl) {
      try {
        await fetch(ctx.aiSettings.webhookCompletionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: ctx.conversationId,
            timestamp: new Date().toISOString(),
          }),
        })
      } catch (err) {
        log.warn('[hooks-system] webhook POST failed', errToCtx(err))
      }
    }
    return undefined
  })
}
