import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent'
import type { CanUseToolFn } from './canUseTool'

export interface PiPermissionGateOptions {
  canUseTool: CanUseToolFn
  bypass: boolean
}

function denyResult(message: string): AgentToolResult<unknown> & { isError: boolean } {
  return {
    content: [{ type: 'text', text: `Permission denied: ${message}` }],
    details: undefined,
    isError: true,
  } as AgentToolResult<unknown> & { isError: boolean }
}

function errorResult(message: string): AgentToolResult<unknown> & { isError: boolean } {
  return {
    content: [{ type: 'text', text: `Permission check failed: ${message}` }],
    details: undefined,
    isError: true,
  } as AgentToolResult<unknown> & { isError: boolean }
}

export function gatePiTools(
  tools: ToolDefinition[],
  opts: PiPermissionGateOptions,
): ToolDefinition[] {
  if (opts.bypass) return tools
  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) return denyResult('aborted before approval')
      let decision
      try {
        // canUseTool is not signal-aware: mid-approval aborts are observed only after
        // the user responds. This matches the Claude SDK path's CanUseToolFn contract.
        decision = await opts.canUseTool(tool.name, params as Record<string, unknown>)
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
      if (decision.behavior === 'deny') {
        return denyResult(decision.message ?? 'denied by user')
      }
      const effectiveParams = decision.updatedInput ?? params
      return tool.execute(toolCallId, effectiveParams, signal, onUpdate, ctx)
    },
  }))
}
