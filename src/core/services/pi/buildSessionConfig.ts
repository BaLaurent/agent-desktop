// PI-SDK session configuration: resource loader, permission gate, tool assembly.
//
// Owns: DefaultResourceLoader construction, canUseTool creation, CWD restriction
// wrapping of built-in coding tools, permission gating of built-in tools, and
// conditional scheduler-tool inclusion. Callers receive a ready-to-pass config
// for pi.createAgentSession().

import { createCanUseTool } from '../canUseTool'
import { pendingRequests, sendChunk } from '../streaming'
import {
  isPathOutsideReadAllowed,
  isPathOutsideWriteAllowed,
  isPathOutsideAllowed,
  extractBashReadPaths,
  extractBashWritePaths,
} from '../cwdHooks'
import type { CanUseToolFn } from '../canUseTool'
import type { AISettings } from '../streaming'
import type { CwdWhitelistEntry } from '../../types'
import type { AgentToolResult } from '@mariozechner/pi-agent-core'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { createBridge, type BridgeDeps, type ExtensionRuntimeContext } from '../piExtensionBridge'
import parityFactory from '../../../extensions/agent-desktop-parity'

/** PI tool name → which parameter holds the target path */
const PI_READ_PATH_TOOLS = new Set(['read', 'find', 'grep', 'ls'])
const PI_WRITE_PATH_TOOLS = new Set(['write', 'edit'])

function denyToolResult(message: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text: `Access denied: ${message}` }], details: undefined }
}

/**
 * Wraps pi.codingTools (AgentTool[]) with CWD read/write restriction checks.
 * Mirrors buildCwdRestrictionHooks semantics:
 *   - Write-path enforcement: always active
 *   - Read-path enforcement: only when whitelist is non-empty (backward compat per CLAUDE.md)
 * Applied unconditionally — mirrors SDK where PreToolUse hooks fire regardless of permissionMode.
 */
function applyCwdRestriction<T extends { name: string; execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>> }>(
  tools: T[],
  cwd: string,
  whitelist: CwdWhitelistEntry[],
): T[] {
  const hasWhitelist = whitelist.length > 0
  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown): Promise<AgentToolResult<unknown>> {
      const name = tool.name

      if (PI_READ_PATH_TOOLS.has(name) && hasWhitelist) {
        const rawPath = (params.path ?? params.file_path) as string | undefined
        if (rawPath) {
          const outside = isPathOutsideReadAllowed(rawPath, cwd, whitelist)
          if (outside) {
            return denyToolResult(`${name} targets "${outside}" which is outside the allowed read directories.`)
          }
        }
      }

      if (PI_WRITE_PATH_TOOLS.has(name)) {
        const rawPath = (params.path ?? params.file_path) as string | undefined
        if (rawPath) {
          const outside = hasWhitelist
            ? isPathOutsideWriteAllowed(rawPath, cwd, whitelist)
            : isPathOutsideAllowed(rawPath, cwd)
          if (outside) {
            return denyToolResult(`${name} targets "${outside}" which is outside the allowed write directories.`)
          }
        }
      }

      if (name === 'bash') {
        const command = params.command as string | undefined
        if (command) {
          const writePaths = extractBashWritePaths(command)
          for (const p of writePaths) {
            const outside = hasWhitelist
              ? isPathOutsideWriteAllowed(p, cwd, whitelist)
              : isPathOutsideAllowed(p, cwd)
            if (outside) {
              return denyToolResult(`bash write target "${outside}" is outside the allowed write directories.`)
            }
          }
          if (hasWhitelist) {
            const readPaths = extractBashReadPaths(command)
            for (const p of readPaths) {
              const outside = isPathOutsideReadAllowed(p, cwd, whitelist)
              if (outside) {
                return denyToolResult(`bash read target "${outside}" is outside the allowed read directories.`)
              }
            }
          }
        }
      }

      return (tool.execute as (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown) => Promise<AgentToolResult<unknown>>)(toolCallId, params, signal, onUpdate)
    },
  }))
}

/**
 * Gates AgentTool[] (pi.codingTools) through canUseTool permission prompts.
 * Skipped entirely when bypass is true (bypassPermissions mode).
 */
function gateAgentTools<T extends { name: string; execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>> }>(
  tools: T[],
  canUseTool: CanUseToolFn,
  bypass: boolean,
): T[] {
  if (bypass) return tools
  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown): Promise<AgentToolResult<unknown>> {
      if (signal?.aborted) {
        return denyToolResult('aborted before approval')
      }
      let decision
      try {
        decision = await canUseTool(tool.name, params)
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Permission check failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: undefined,
        }
      }
      if (decision.behavior === 'deny') {
        return denyToolResult(decision.message ?? 'denied by user')
      }
      const effectiveParams = decision.updatedInput ?? params
      return (tool.execute as (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown) => Promise<AgentToolResult<unknown>>)(toolCallId, effectiveParams, signal, onUpdate)
    },
  }))
}

export interface SessionConfigOptions {
  aiSettings: AISettings | undefined
  conversationId: number | undefined
  convKey: number
  piSdk: {
    DefaultResourceLoader: new (opts: Record<string, unknown>) => { reload(): Promise<void> }
    codingTools: Array<{ name: string; execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>> }>
  }
  sessionStore: Map<string, unknown>
}

export interface SessionConfigResult {
  resourceLoader: { reload(): Promise<void> }
  canUseTool: CanUseToolFn
  bypass: boolean
  gatedCodingTools: Array<{ name: string; execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>> }>
  schedulerCustomTool: ToolDefinition | null
}

export async function buildSessionConfig(opts: SessionConfigOptions): Promise<SessionConfigResult> {
  const { aiSettings, conversationId, convKey, piSdk, sessionStore } = opts

  const disabledPaths = new Set(aiSettings?.piDisabledExtensions || [])
  const extensionBridge = createBridge(conversationId ?? -1, { chunkSender: sendChunk as BridgeDeps['chunkSender'] })
  const runtimeCtx: ExtensionRuntimeContext = {
    version: 1,
    conversationId: conversationId ?? -1,
    aiSettings: aiSettings ?? ({} as AISettings),
    db: null,
    bridge: extensionBridge,
    sessionStore,
  }

  const resourceLoader = new piSdk.DefaultResourceLoader({
    cwd: aiSettings?.cwd || process.cwd(),
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    ...(aiSettings?.piExtensionsDir ? { additionalExtensionPaths: [aiSettings.piExtensionsDir] } : {}),
    extensionFactories: [(piApi: unknown) => parityFactory(piApi as never, runtimeCtx)],
    ...(disabledPaths.size > 0
      ? {
          extensionsOverride: (result: { extensions: Array<{ resolvedPath: string }>; [k: string]: unknown }) => ({
            ...result,
            extensions: result.extensions.filter((ext) => !disabledPaths.has(ext.resolvedPath)),
          }),
        }
      : {}),
  } as Record<string, unknown>) as { reload(): Promise<void> }
  await resourceLoader.reload()

  const resolvedPermissionMode = aiSettings?.permissionMode ?? 'bypassPermissions'
  const bypass = resolvedPermissionMode === 'bypassPermissions'
  const canUseToolFn = createCanUseTool({
    aiSettings: {
      requirePlanApproval: aiSettings?.requirePlanApproval,
      disabledSkills: aiSettings?.disabledSkills,
    },
    permissionMode: resolvedPermissionMode,
    chunkConversationId: conversationId ?? null,
    pendingRequestsKey: convKey,
    pendingRequests,
    sendChunk: sendChunk,
    onApprovalStart: () => {},
    onApprovalEnd: () => {},
  })

  const cwdRestricted = applyCwdRestriction(
    piSdk.codingTools,
    aiSettings?.cwd || process.cwd(),
    (aiSettings?.cwdWhitelist as CwdWhitelistEntry[] | undefined) ?? [],
  )
  const gatedCodingTools = gateAgentTools(cwdRestricted, canUseToolFn, bypass)

  return {
    resourceLoader,
    canUseTool: canUseToolFn,
    bypass,
    gatedCodingTools,
    schedulerCustomTool: null, // Resolved by orchestrator after config is built
  }
}
