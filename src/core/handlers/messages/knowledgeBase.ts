// Knowledge base ingestion for the system prompt.
//
// Reads files from `<knowledgesDir>/<sel.folder>/...` up to `KB_BUDGET`
// bytes, appending each file as a tagged block to the prompt. Also
// returns the list of writable paths so the caller can append the
// "you have write access to" footer (kept in messages.ts for cohesion
// with the system-prompt assembly).
//
// Path traversal protection: any selection containing `..`, `/`, or `\`
// in the folder name is silently skipped. The resolved path is also
// re-checked against `knowledgesDir` to defeat symlink shenanigans.

import { promises as fsp } from 'fs'
import { join, extname, resolve, relative } from 'path'
import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import type { KnowledgeSelection, CwdWhitelistEntry } from '../../types/types'
import { safeJsonParse } from '../../utils/json'
import { cascadeStringKey, getFolderOverrides, parseConvOverrides, getConversationOverrideContext } from './cascade'

const KB_BUDGET = 500_000

interface KnowledgeBaseResult {
  /** Pre-formatted text to append to the system prompt (may be empty). */
  content: string
  /** Resolved absolute paths of folders flagged `readwrite`. */
  writablePaths: string[]
}

/** Validate a single selection and return its resolved absolute path, or null to skip. */
function resolveSelection(
  sel: KnowledgeSelection | null | undefined,
  knowledgesDir: string,
): string | null {
  if (!sel || typeof sel.folder !== 'string' || !sel.folder) return null
  if (sel.folder.includes('..') || sel.folder.includes('/') || sel.folder.includes('\\')) return null
  const resolved = resolve(join(knowledgesDir, sel.folder))
  if (!resolved.startsWith(knowledgesDir)) return null
  return resolved
}

/**
 * Build the knowledge-base content block from the parsed selections.
 *
 * Files larger than the remaining budget are truncated rather than
 * skipped — a single oversized file would otherwise leave the entire
 * collection silently absent.
 */
async function injectKnowledgeBase(
  knowledgeFoldersRaw: string | undefined,
  knowledgesDir: string | undefined,
  supportedExts: Set<string>,
): Promise<KnowledgeBaseResult> {
  if (!knowledgeFoldersRaw || !knowledgesDir) {
    return { content: '', writablePaths: [] }
  }

  const selections = safeJsonParse<KnowledgeSelection[]>(knowledgeFoldersRaw, [])
  if (!Array.isArray(selections) || selections.length === 0) {
    return { content: '', writablePaths: [] }
  }

  let kbContent = ''
  let totalSize = 0
  const writablePaths: string[] = []

  for (const sel of selections) {
    const collectionPath = resolveSelection(sel, knowledgesDir)
    if (!collectionPath) continue

    const access = sel.access === 'readwrite' ? 'readwrite' : 'read'
    if (access === 'readwrite') writablePaths.push(collectionPath)

    const reachedBudget = await readCollectionFiles(
      collectionPath,
      collectionPath,
      sel.folder,
      access,
      supportedExts,
      (chunk, chunkSize) => {
        kbContent += chunk
        totalSize += chunkSize
        return totalSize >= KB_BUDGET
      },
      () => KB_BUDGET - totalSize,
    )
    if (reachedBudget) break
  }

  return { content: kbContent, writablePaths }
}

async function readCollectionFiles(
  collectionRoot: string,
  dir: string,
  selFolder: string,
  access: 'read' | 'readwrite',
  supportedExts: Set<string>,
  onChunk: (chunk: string, chunkSize: number) => boolean,
  remaining: () => number,
): Promise<boolean> {
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch { return false }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      const done = await readCollectionFiles(collectionRoot, fullPath, selFolder, access, supportedExts, onChunk, remaining)
      if (done) return true
    } else if (supportedExts.has(extname(entry.name).toLowerCase())) {
      try {
        let content = await fsp.readFile(fullPath, 'utf-8')
        const left = remaining()
        if (left <= 0) return true
        let truncated = false
        if (content.length > left) {
          content = content.slice(0, left)
          truncated = true
        }
        const relPath = relative(collectionRoot, fullPath)
        const suffix = truncated ? '\n[...truncated]' : ''
        const block = `\n\n--- Knowledge [${access}]: ${selFolder}/${relPath} ---\n${content}${suffix}\n---`
        if (onChunk(block, content.length)) return true
      } catch {
        continue
      }
    }
  }
  return false
}

// ─── System Prompt Assembly ───────────────────────────────────

const DEFAULT_KB_EXTS = new Set([
  '.txt', '.md', '.js', '.ts', '.py', '.json', '.csv', '.yaml', '.yml',
])

const SCHEDULER_DIRECTIVE =
  '\n\nYou have access to a built-in task scheduler via MCP tools (schedule_task, list_scheduled_tasks, cancel_scheduled_task). ' +
  'Use these tools for reminders, scheduled tasks, and recurring actions. ' +
  'Do NOT use cron, at, systemd timers, or other system schedulers — always use the built-in schedule_task tool. ' +
  'For one-time reminders, use the delay_minutes parameter. For recurring tasks, use interval_value + interval_unit.'

interface ConversationPromptRow {
  system_prompt: string | null
  folder_id: number | null
  ai_overrides: string | null
}

function buildBasePrompt(
  db: SqlJsAdapter,
  cwdDirective: string,
  row: ConversationPromptRow | undefined,
  convOv: Record<string, string>,
): string {
  if (row?.system_prompt) {
    return `${cwdDirective}\n\n${row.system_prompt}`
  }
  const cascadedPrompt = cascadeStringKey(db, 'ai_defaultSystemPrompt', convOv, row?.folder_id ?? null)
  return cascadedPrompt ? `${cwdDirective}\n\n${cascadedPrompt}` : cwdDirective
}

/** Cascaded agent persona/language directives for a conversation. */
export interface AgentDirectives {
  name?: string
  personality?: string
  language?: string
}

/**
 * Resolve the cascaded `agent_personality` / `agent_language` settings for
 * a conversation. Standalone entry point so consumers without the full
 * system-prompt assembly (e.g. the TTS summary) can apply the same persona.
 */
export function getAgentDirectives(db: SqlJsAdapter, conversationId: number): AgentDirectives {
  const { folderId, aiOverridesRaw } = getConversationOverrideContext(db, conversationId)
  const convOv = parseConvOverrides(aiOverridesRaw)
  return {
    name: cascadeStringKey(db, 'agent_name', convOv, folderId),
    personality: cascadeStringKey(db, 'agent_personality', convOv, folderId),
    language: cascadeStringKey(db, 'agent_language', convOv, folderId),
  }
}

/**
 * Single source of truth for the persona/language directive text. Returns
 * a block that can prefix any prompt (system prompt assembly) or stand
 * alone as a `systemPrompt` (TTS summary). Empty when nothing is set.
 */
export function formatAgentDirectives(d: AgentDirectives): string {
  let out = ''
  if (d.language) out += `Always respond in ${d.language}.\n\n`
  if (d.personality) out += `Personality: ${d.personality}\n\n`
  return out
}

function applyAgentDecorators(
  db: SqlJsAdapter,
  prompt: string,
  convOv: Record<string, string>,
  folderId: number | null,
): string {
  const directives: AgentDirectives = {
    personality: cascadeStringKey(db, 'agent_personality', convOv, folderId),
    language: cascadeStringKey(db, 'agent_language', convOv, folderId),
  }
  return formatAgentDirectives(directives) + prompt
}

function resolveKnowledgeFoldersRaw(
  db: SqlJsAdapter,
  convOv: Record<string, string>,
  folderId: number | null,
): string | undefined {
  const direct = convOv['ai_knowledgeFolders']
  if (direct) return direct
  if (folderId) return getFolderOverrides(db, folderId)['ai_knowledgeFolders']
  return undefined
}

/**
 * Build the system prompt for a conversation. Encapsulates the full
 * cascade (system_prompt → ai_defaultSystemPrompt cascade), agent
 * personality/language decorators, knowledge-base ingestion, and the
 * scheduler directive when scheduler MCP is enabled for this conv.
 */
export async function assembleSystemPrompt(
  db: SqlJsAdapter,
  conversationId: number,
  cwd: string,
  opts?: {
    knowledgesDir?: string
    supportedKnowledgeExts?: Set<string>
    getSchedulerMcpConfig?: (id: number) => Record<string, unknown> | null
  },
): Promise<string> {
  const cwdDirective = `Your working directory is ${cwd}. Use absolute paths for all file operations.`

  const row = (db as any)
    .prepare('SELECT system_prompt, folder_id, ai_overrides FROM conversations WHERE id = ?')
    .get(conversationId) as ConversationPromptRow | undefined

  const convOv = parseConvOverrides(row?.ai_overrides)
  const folderId = row?.folder_id ?? null

  let prompt = buildBasePrompt(db, cwdDirective, row, convOv)
  prompt = applyAgentDecorators(db, prompt, convOv, folderId)

  const knowledgeFoldersRaw = resolveKnowledgeFoldersRaw(db, convOv, folderId)
  const supportedExts = opts?.supportedKnowledgeExts ?? DEFAULT_KB_EXTS
  const kb = await injectKnowledgeBase(knowledgeFoldersRaw, opts?.knowledgesDir, supportedExts)
  if (kb.content) prompt += kb.content
  if (kb.writablePaths.length > 0) {
    prompt += '\n\nYou have write access to the following knowledge directories:\n' +
      kb.writablePaths.map(p => `- ${p}`).join('\n')
  }

  if (opts?.getSchedulerMcpConfig && opts.getSchedulerMcpConfig(conversationId) !== null) {
    prompt += SCHEDULER_DIRECTIVE
  }

  return prompt
}

/**
 * Merge knowledge-folder selections into the cwdWhitelist with proper
 * path validation. Mutates the passed array in place.
 */
export function mergeKnowledgeFoldersIntoWhitelist(
  cwdWhitelist: CwdWhitelistEntry[],
  knowledgeFoldersRaw: string | undefined,
  knowledgesDir: string | undefined,
): void {
  if (!knowledgesDir || !knowledgeFoldersRaw) return
  const selections = safeJsonParse<KnowledgeSelection[]>(knowledgeFoldersRaw, [])
  if (!Array.isArray(selections)) return
  for (const sel of selections) {
    const resolved = resolveSelection(sel, knowledgesDir)
    if (!resolved) continue
    const access = sel.access === 'readwrite' ? 'readwrite' : 'read'
    cwdWhitelist.push({ path: resolved, access })
  }
}
