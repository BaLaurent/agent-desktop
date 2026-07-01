// Scheduler host-tool for the omp RPC backend.
//
// Ported from streamingPI.ts's createSchedulerTool/executeSchedulerCommand.
// Exposes `agent_scheduler` as an OmpHostTool so omp can create/list/cancel
// scheduled tasks for the current conversation via the in-process scheduler
// bridge socket. Trusted internal tool — not subject to user approval.

import { createConnection } from 'node:net'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'
import type { PISchedulerBridgeAccessor } from '../streaming'
import type { OmpHostTool, OmpToolResult } from './ompRpcClient'

const SchedulerToolParams = /* #__PURE__ */ (() =>
  Type.Object({
    conversation_id: Type.Number({ description: 'Conversation ID for the task', minimum: 1 }),
    command: Type.String({ description: 'Command to execute: "create", "list", or "cancel"' }),
    name: Type.Optional(Type.String({ description: 'Task name (for create)' })),
    prompt: Type.Optional(Type.String({ description: 'Task prompt (for create)' })),
    interval_value: Type.Optional(Type.Integer({ description: 'Interval value in units (for create)', minimum: 1 })),
    interval_unit: Type.Optional(Type.String({ description: 'Interval unit: minutes/hours/days (for create)' })),
    schedule_time: Type.Optional(Type.String({ description: 'Schedule time HH:MM (for create)' })),
    max_runs: Type.Optional(Type.Integer({ description: 'Max runs (for create)', minimum: 1 })),
    task_id: Type.Optional(Type.Integer({ description: 'Task ID (for cancel)', minimum: 1 })),
  }))()

interface SchedulerToolParams extends Static<typeof SchedulerToolParams> {}

interface SchedulerBridgeResponse {
  id?: number
  name?: string
  next_run_at?: string
  max_runs?: number | null
  deleted?: boolean
  result?: unknown[]
  error?: string
}

interface SchedulerTask {
  id: number
  name: string
  enabled: boolean
  interval_value: number
  interval_unit: string
  next_run_at: string
  run_count: number
}

/** Send a scheduler command over the bridge socket (newline-delimited JSON). */
function executeSchedulerCommand(
  bridge: PISchedulerBridgeAccessor,
  conversationId: number,
  command: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const socketPath = bridge.getSocketPath()
  const authToken = bridge.getAuthToken()
  if (!socketPath || !authToken) {
    return Promise.reject(new Error('Scheduler bridge not started'))
  }

  const { promise, resolve, reject } = Promise.withResolvers<unknown>()
  const socket = createConnection(socketPath, () => {
    socket.write(
      JSON.stringify({
        method: `scheduler.${command}`,
        token: authToken,
        params: { conversation_id: conversationId, ...params },
      }) + '\n',
    )
  })

  let buffer = ''
  let resolved = false
  // Settle once, then close the socket so it stops holding the event loop open.
  const finish = (settle: () => void) => {
    if (resolved) return
    resolved = true
    settle()
    socket.destroy()
  }

  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const response = JSON.parse(trimmed) as SchedulerBridgeResponse
        finish(() => (response.error ? reject(new Error(response.error)) : resolve(response)))
      } catch {
        // keep accumulating until a full JSON line arrives
      }
    }
  })
  socket.on('error', (err) => finish(() => reject(err)))
  socket.on('close', () => finish(() => resolve(null)))
  socket.setTimeout(5000, () => finish(() => reject(new Error('Scheduler bridge timeout'))))

  return promise
}

function textResult(text: string): OmpToolResult {
  return { content: [{ type: 'text', text }] }
}

function formatResult(command: string, result: unknown): OmpToolResult {
  if (command === 'list' && Array.isArray(result)) {
    const tasks = result as SchedulerTask[]
    const lines = tasks.map((t) => {
      const nextRun = t.next_run_at ? new Date(t.next_run_at).toLocaleString() : 'N/A'
      return `#${t.id} ${t.enabled ? '✅' : '⏸️'} ${t.name} (${t.interval_value}${t.interval_unit}) - ${nextRun} (run #${t.run_count})`
    })
    return textResult(lines.length ? lines.join('\n') : 'No scheduled tasks')
  }
  if (command === 'create') {
    const r = result as { id: number; name: string; next_run_at?: string }
    return textResult(`Task created: ID ${r.id} "${r.name}" (next: ${r.next_run_at ?? 'N/A'})`)
  }
  if (command === 'cancel') {
    const deleted = result && typeof result === 'object' && 'deleted' in result
    return textResult(deleted ? 'Task cancelled' : 'Cancel result unknown')
  }
  return textResult(JSON.stringify(result, null, 2))
}

/** Build the `agent_scheduler` host-tool bound to the given scheduler bridge. */
export function createOmpSchedulerTool(bridge: PISchedulerBridgeAccessor): OmpHostTool {
  return {
    name: 'agent_scheduler',
    label: 'Agent Scheduler',
    description:
      'Schedule tasks to run at specific times or intervals. Use this tool to create, list, or cancel scheduled tasks for the current conversation.',
    parameters: SchedulerToolParams as unknown as Record<string, unknown>,
    async execute(params) {
      const p = params as SchedulerToolParams
      const result = await executeSchedulerCommand(bridge, p.conversation_id, p.command, {
        name: p.name,
        prompt: p.prompt,
        interval_value: p.interval_value,
        interval_unit: p.interval_unit,
        schedule_time: p.schedule_time,
        max_runs: p.max_runs,
        task_id: p.task_id,
      })
      return formatResult(p.command, result)
    },
  }
}
