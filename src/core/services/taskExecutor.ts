import type { Database } from 'better-sqlite3'
import type { ScheduledTask, ToolCall } from '../types'
import type { AISettings } from './streaming'
import type { SchedulerService } from './scheduler'
import { resolveVariablesWithReport } from './variableResolver'
import { createLogger, errToCtx } from '../utils/logger'

const log = createLogger('taskExecutor')

// ─── TaskRunContext (injected by Electron or headless) ─────

interface StreamResult {
  content: string
  toolCalls: ToolCall[]
  aborted: boolean
  sessionId: string | null
  error?: string
}

export interface TaskRunContext {
  buildHistory(conversationId: number): Array<{ role: 'user' | 'assistant'; content: string }>
  getAISettings(conversationId: number): AISettings
  getSystemPrompt(conversationId: number, cwd: string): Promise<string>
  streamMessage(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    systemPrompt: string,
    aiSettings: AISettings,
    conversationId: number
  ): Promise<StreamResult>
  saveMessage(conversationId: number, role: string, content: string, attachments?: unknown[], toolCalls?: ToolCall[]): void
  notify(title: string, body: string): Promise<void>
  /** Called when a task or conversation state changes — broadcast to renderer / logs */
  onTaskUpdate(task: ScheduledTask): void
  onConversationsRefresh(): void
  /** Soft-clear the conversation history before the next run (equivalent to /clear). */
  clearConversation(conversationId: number): void
  /** Summarize and clear the conversation history before the next run (equivalent to /compact). */
  compactConversation(conversationId: number): Promise<void>
  /** Read-only DB handle — used by variableResolver builtins (e.g., previous_output). */
  db: Database
}

// ─── executeTask ───────────────────────────────────────────

/**
 * Execute a scheduled task. Pure orchestration — all I/O goes through ctx.
 * Manages: mark running → verify conversation → build context → stream → save → mark success/error → notify.
 */
export async function executeTask(
  scheduler: SchedulerService,
  ctx: TaskRunContext,
  task: ScheduledTask
): Promise<void> {
  scheduler.markRunning(task.id)
  ctx.onTaskUpdate({ ...task, last_status: 'running' })

  try {
    // Verify conversation still exists — recreate if deleted
    const originalConvId = task.conversation_id
    task = scheduler.ensureConversation(task)
    if (task.conversation_id !== originalConvId) {
      ctx.onConversationsRefresh()
    }

    // Load AI settings early — we need cwd for variable resolution
    const aiSettings = ctx.getAISettings(task.conversation_id)

    // Pre-run context preparation (keep / clear / compact before this run's prompt is saved)
    if (task.pre_run_action === 'clear') {
      ctx.clearConversation(task.conversation_id)
    } else if (task.pre_run_action === 'compact') {
      try {
        await ctx.compactConversation(task.conversation_id)
      } catch (err) {
        log.warn('compact failed, falling back to clear', errToCtx(err, { taskName: task.name, taskId: task.id }))
        ctx.clearConversation(task.conversation_id)
      }
    }

    // Resolve variables in the prompt (built-ins + ~/.agent-desktop/functions/*.ts)
    const { resolved: resolvedPrompt, errors: resolverErrors } =
      await resolveVariablesWithReport(task.prompt, {
        task,
        cwd: aiSettings.cwd || process.cwd(),
        db: ctx.db,
        now: new Date(),
      })
    if (resolverErrors.length > 0) {
      log.warn('variable resolution errors', { taskName: task.name, taskId: task.id, errors: resolverErrors })
    }

    // Save user message (resolved prompt)
    ctx.saveMessage(task.conversation_id, 'user', resolvedPrompt)

    // Build context — same flow as messages:send
    const history = ctx.buildHistory(task.conversation_id)

    // Force bypass for unattended execution
    aiSettings.permissionMode = 'bypassPermissions'

    // Disable plan-approval gating: there is no UI to approve ExitPlanMode in cron;
    // canUseTool would await a renderer response that never arrives, hanging the
    // SDK CLI until it exits with code 1. (Regression introduced by 6d74c91.)
    aiSettings.requirePlanApproval = false

    // Prevent recursive task creation: remove scheduler MCP from unattended execution
    delete aiSettings.mcpServers?.['agent_scheduler']

    const systemPrompt = await ctx.getSystemPrompt(task.conversation_id, aiSettings.cwd!)

    const { content, toolCalls, error } = await ctx.streamMessage(
      history, systemPrompt, aiSettings, task.conversation_id
    )

    if (error) throw new Error(error)

    // Persist when there is text OR tool activity. On the PI path the agent
    // commonly answers via tool calls only (no narration), and dropping those
    // erases the only on-disk trace of what the run actually did.
    if (content || toolCalls?.length) {
      if (scheduler.conversationExists(task.conversation_id)) {
        ctx.saveMessage(task.conversation_id, 'assistant', content, [], toolCalls)
      }
    }

    // Mark success + compute next run
    scheduler.markSuccess(task.id, task)

    const updated = scheduler.get(task.id)
    if (updated) ctx.onTaskUpdate(updated)

    // Notifications
    if (task.notify_desktop) {
      await ctx.notify(task.name, (content || 'Task completed').slice(0, 200)).catch(() => {})
    }

    // Refresh conversation list
    ctx.onConversationsRefresh()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    scheduler.markError(task.id, task, errorMsg)

    const updated = scheduler.get(task.id)
    if (updated) ctx.onTaskUpdate(updated)

    log.error('Task failed', new Error(errorMsg), { taskName: task.name, taskId: task.id })
  }
}
