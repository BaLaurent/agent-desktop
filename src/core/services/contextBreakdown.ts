/**
 * Context usage breakdown, Claude Code `/context` style.
 *
 * Strategy:
 *   - Count *what we own* locally with a BPE tokenizer (system prompt, message
 *     history, compact summary). Fast, offline.
 *   - For MCP tool specs and SDK internals we can't cheaply introspect, derive
 *     a single "Tools & overhead" bucket from `sdk_total − locally_counted`,
 *     using the numbers the SDK persisted on the last turn. Honest over precise.
 *   - Always reserve an autocompact buffer (~3% of the window) so the ceiling
 *     we show matches what a /compact operation would actually need.
 *
 * The total reflects CONTENT we can tokenize locally (system prompt, message
 * history, compact summary, skills, tool exchanges) — not the SDK's
 * cache-inclusive billing cost. Fast, offline, zero API round-trips.
 */

import { promises as fsp } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { localTokenizer } from '../../shared/tokenCounter'
import { getEffectiveContextWindow } from '../../shared/contextWindow'
import { parseCustomModelContextLengths } from '../types/constants'

export interface ContextCategory {
  /** Translation key / UI label. Keep short — the bubble lists these vertically. */
  label: string
  /** Approximate token count. `null` means "unknown, not yet measurable". */
  tokens: number | null
  /** Purely informational hint shown in a small muted font. */
  hint?: string
  /** When true: show the size for info but don't include in the usage total — the
   *  SDK may strip or compact this content out of the live context window. */
  informational?: boolean
}

export interface ContextBreakdown {
  /** Best estimate of total tokens in the context for the NEXT turn. */
  total: number
  /** Effective window size (SDK + static + custom override). */
  window: number
  /** Reserved capacity for a future /compact call (~3% of window). */
  autocompactBuffer: number
  /** `window - total - autocompactBuffer`, clamped at 0. */
  free: number
  /** Percentage of the window used, 0–100. */
  percentUsed: number
  /** Human-readable categories in display order. */
  categories: ContextCategory[]
  /** True if no turn has completed yet — the "overhead" category is guessed/unknown. */
  preFirstTurn: boolean
  /** Optional actionable advice for the user (e.g. "drop ai_skills to user to save ~X tokens"). */
  tip?: string
}

interface ConversationRow {
  model: string | null
  compact_summary: string | null
  cleared_at: string | null
  last_input_tokens: number | null
  last_output_tokens: number | null
  last_cache_read_tokens: number | null
  last_cache_creation_tokens: number | null
  last_context_window: number | null
}

interface SettingsRow { key: string; value: string | null }

function readConversation(db: SqlJsAdapter, conversationId: number): ConversationRow | null {
  const row = (db as unknown as { prepare: (q: string) => { get: (p: number) => unknown } })
    .prepare(`SELECT model, compact_summary, cleared_at,
                     last_input_tokens, last_output_tokens,
                     last_cache_read_tokens, last_cache_creation_tokens,
                     last_context_window
              FROM conversations WHERE id = ?`)
    .get(conversationId) as ConversationRow | undefined
  return row ?? null
}

function readSetting(db: SqlJsAdapter, key: string): string | null {
  const row = (db as unknown as { prepare: (q: string) => { get: (p: string) => unknown } })
    .prepare('SELECT key, value FROM settings WHERE key = ?')
    .get(key) as SettingsRow | undefined
  return row?.value ?? null
}

interface MessageRow { content: string; tool_calls: string | null; role: 'user' | 'assistant' }

function fetchMessages(db: SqlJsAdapter, conversationId: number, clearedAt: string | null): MessageRow[] {
  let query = 'SELECT content, tool_calls, role FROM messages WHERE conversation_id = ?'
  const params: (number | string)[] = [conversationId]
  if (clearedAt) {
    query += ' AND created_at > ?'
    params.push(clearedAt)
  }
  query += ' ORDER BY created_at ASC'
  const rows = (db as unknown as { prepare: (q: string) => { all: (...p: unknown[]) => unknown[] } })
    .prepare(query).all(...params) as MessageRow[]
  return rows
}

export interface BuildBreakdownInput {
  db: SqlJsAdapter
  conversationId: number
  /** Precomputed system prompt — caller should pass what will actually be sent to the SDK. */
  systemPrompt: string
  /** Effective skills discovery mode (from ai_skills cascade). Controls which scopes to scan. */
  skillsMode?: 'off' | 'user' | 'project' | 'local'
  /** Project CWD — needed to resolve project/local skill scopes. */
  cwd?: string
}

/**
 * Count tokens bundled into the system prompt as SKILL.md frontmatters, by scanning
 * the same scopes the Claude Agent SDK would via `settingSources`.
 *
 * The SDK reads `.claude/skills/*\/SKILL.md` and `.claude/plugins/*\/skills/*\/SKILL.md`
 * under each enabled scope and bundles the frontmatter block (name + description + more)
 * of every skill into the initial system prompt so the model can decide which to invoke.
 *
 * With many plugins installed (1000+ skills seen in the wild), this can silently add
 * ~100k tokens to the context on every turn. We count it so the user sees it.
 */
/**
 * Compute the token overhead per skills mode so the settings UI can preview
 * each option's cost before the user picks one.
 */
export async function computeSkillsOverheadPerMode(
  cwd?: string
): Promise<Record<'off' | 'user' | 'project' | 'local', { tokens: number; count: number }>> {
  const off = { tokens: 0, count: 0 }
  const user = await countSkillsFrontmatters(scopesForSkillsMode('user', cwd))
  const project = await countSkillsFrontmatters(scopesForSkillsMode('project', cwd))
  const local = await countSkillsFrontmatters(scopesForSkillsMode('local', cwd))
  return { off, user, project, local }
}

interface SkillScope {
  /** Directory with loose SKILL.md files to walk recursively. */
  skillsDir?: string
  /** installed_plugins.json whose entry `installPath`s are walked for SKILL.md. */
  installedPluginsJson?: string
}

/**
 * Count tokens bundled into the system prompt as SKILL.md frontmatters, matching
 * the Claude Agent SDK's actual discovery.
 *
 * CRITICAL: plugin skills are NOT read wholesale from `~/.claude/plugins/**`. That
 * path contains `marketplaces/` (catalogues of available-but-not-installed plugins
 * — tens of thousands of SKILL.md files on any machine with registered marketplaces)
 * alongside `cache/` which holds the real installed payloads. The SDK resolves the
 * truth via `installed_plugins.json`, listing each installed plugin's `installPath`.
 * Walking the whole tree over-counts by ~30x on a typical dev setup.
 *
 * This function walks:
 *   - each explicit `skillsDir` recursively for loose SKILL.md files, and
 *   - each entry in `installed_plugins.json`'s `installPath`, mirroring SDK discovery.
 */
async function countSkillsFrontmatters(scopes: SkillScope[]): Promise<{ tokens: number; count: number }> {
  let tokens = 0
  let count = 0
  const seen = new Set<string>()

  async function walk(dir: string): Promise<void> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch { return }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (e.name === 'SKILL.md' && !seen.has(full)) {
        seen.add(full)
        try {
          const content = await fsp.readFile(full, 'utf-8')
          const m = content.match(/^---\s*\n([\s\S]*?)\n---/)
          if (m) {
            tokens += localTokenizer.count(m[1])
            count++
          }
        } catch { /* unreadable — skip */ }
      }
    }
  }

  async function installedPluginPaths(jsonPath: string): Promise<string[]> {
    try {
      const raw = await fsp.readFile(jsonPath, 'utf-8')
      const parsed = JSON.parse(raw) as { plugins?: Record<string, Array<{ installPath?: string }>> }
      const out: string[] = []
      for (const entries of Object.values(parsed.plugins || {})) {
        for (const entry of entries) {
          if (entry.installPath) out.push(entry.installPath)
        }
      }
      return out
    } catch { return [] }
  }

  for (const scope of scopes) {
    if (scope.skillsDir) await walk(scope.skillsDir)
    if (scope.installedPluginsJson) {
      const paths = await installedPluginPaths(scope.installedPluginsJson)
      for (const p of paths) await walk(p)
    }
  }
  return { tokens, count }
}

function scopesForSkillsMode(mode: 'off' | 'user' | 'project' | 'local', cwd?: string): SkillScope[] {
  if (mode === 'off') return []
  const userHome = join(homedir(), '.claude')
  const scopes: SkillScope[] = [{
    skillsDir: join(userHome, 'skills'),
    installedPluginsJson: join(userHome, 'plugins', 'installed_plugins.json'),
  }]
  // Project/local scopes don't carry their own plugin marketplace — only loose skills.
  if ((mode === 'project' || mode === 'local') && cwd) {
    scopes.push({ skillsDir: join(cwd, '.claude', 'skills') })
  }
  if (mode === 'local' && cwd) {
    scopes.push({ skillsDir: join(cwd, '.claude.local', 'skills') })
  }
  return scopes
}

const AUTOCOMPACT_BUFFER_RATIO = 0.03 // 3% — matches Claude Code's reserve

export async function buildContextBreakdown(input: BuildBreakdownInput): Promise<ContextBreakdown> {
  const { db, conversationId, systemPrompt, skillsMode = 'off', cwd } = input

  const conv = readConversation(db, conversationId)
  if (!conv) {
    return emptyBreakdown()
  }

  // --- Compute window ---
  const customOverrides = parseCustomModelContextLengths(readSetting(db, 'ai_customModelContextLengths') || undefined)
  const window = getEffectiveContextWindow(conv.model ?? null, conv.last_context_window ?? null, customOverrides)

  // --- Locally-counted categories ---
  const systemPromptTokens = localTokenizer.count(systemPrompt)

  let compactSummaryTokens = 0
  if (conv.compact_summary) {
    compactSummaryTokens = localTokenizer.count(`[Previous conversation summary]\n${conv.compact_summary}`)
  }

  const rows = fetchMessages(db, conversationId, conv.cleared_at)
  const messagesTokens = rows.reduce((sum, r) => sum + localTokenizer.count(r.content), 0)
  // Tool exchanges are INFORMATIONAL only — we tokenize the tool_calls column to
  // give the user a sense of how much tool I/O has passed through the conversation,
  // but we do NOT add this to `localCounted` (the subtraction basis for overhead).
  // Rationale: the Claude Agent SDK does server-side context management on tool
  // results (they may be stripped or compacted after a few turns), so we can't
  // assume every byte of tool_calls is still in the active context. Attributing
  // them falsely would under-count the derived 'Tools & SDK overhead' bucket.
  const toolExchangesTokens = rows.reduce((sum, r) => {
    if (!r.tool_calls) return sum
    return sum + localTokenizer.count(r.tool_calls)
  }, 0)

  // --- Skills: frontmatter of every SKILL.md in the enabled scopes ---
  const skillScopes = scopesForSkillsMode(skillsMode, cwd)
  const skills = skillScopes.length > 0
    ? await countSkillsFrontmatters(skillScopes)
    : { tokens: 0, count: 0 }

  const localCounted = systemPromptTokens + compactSummaryTokens + messagesTokens + toolExchangesTokens + skills.tokens

  // --- Derive the "Tools & SDK overhead" bucket from the last SDK turn ---
  const preFirstTurn = conv.last_input_tokens == null
    && conv.last_cache_read_tokens == null
    && conv.last_cache_creation_tokens == null

  const sdkReportedTotal = (conv.last_input_tokens ?? 0)
    + (conv.last_cache_read_tokens ?? 0)
    + (conv.last_cache_creation_tokens ?? 0)

  // --- Build category list — only content we can tokenize locally ---
  const categories: ContextCategory[] = []
  categories.push({ label: 'System prompt', tokens: systemPromptTokens })
  if (compactSummaryTokens > 0) {
    categories.push({
      label: 'Compact summary',
      tokens: compactSummaryTokens,
      hint: 'injected as synthetic assistant turn',
    })
  }
  categories.push({
    label: 'Messages',
    tokens: messagesTokens,
    hint: rows.length > 0 ? `${rows.length} turn${rows.length > 1 ? 's' : ''}` : undefined,
  })
  if (toolExchangesTokens > 0) {
    const toolCount = rows.filter((r) => r.tool_calls).length
    categories.push({
      label: 'Tool exchanges',
      tokens: toolExchangesTokens,
      hint: `tool_use + tool_result across ${toolCount} turn${toolCount > 1 ? 's' : ''}`,
    })
  }
  if (skills.count > 0) {
    categories.push({
      label: 'Skills',
      tokens: skills.tokens,
      hint: `${skills.count} SKILL.md frontmatters bundled (ai_skills: ${skillsMode})`,
    })
  }

  // Informational: how much the SDK reports on top of what we can tokenize
  // (MCP tool specs, built-in tools, SDK internal system prompt, etc.).
  // NOT included in the total — this is what the user can't directly control
  // via messages, only via disabling MCP servers or changing skills mode.
  if (!preFirstTurn) {
    const sdkDerived = Math.max(0, sdkReportedTotal - localCounted)
    if (sdkDerived > 0) {
      categories.push({
        label: 'Framework & MCP tools',
        tokens: sdkDerived,
        hint: `SDK-reported overhead (MCP specs + framework) — disable unused MCPs to shrink`,
        informational: true,
      })
    }
  }

  // --- Total ---
  // Policy: the headline reflects CONTENT we can tokenize locally, not the
  // SDK's cache-inclusive cost. Rationale:
  //   - cache_read grows every turn as history is re-read; this made the
  //     headline appear to grow even when the user added no content
  //   - cache_creation spikes on tool turns for transient content that the
  //     SDK typically strips next turn (non-durable)
  //   - users care about "how much conversation is really stored" for planning
  //     compacts/clears, not the server-side billing accounting
  //
  // localCounted already includes tool exchanges + skills + system prompt +
  // messages + compact summary. Excludes SDK-cached framework overhead we can't
  // measure locally (MCP tool specs, SDK system prompt).
  const total = localCounted

  const autocompactBuffer = Math.round(window * AUTOCOMPACT_BUFFER_RATIO)
  const free = Math.max(0, window - total - autocompactBuffer)
  const percentUsed = window > 0 ? Math.min(100, Math.round((total / window) * 100)) : 0

  // Actionable tip — surface the most impactful thing the user can change.
  const tip = buildTip({ skills, skillsMode, toolExchangesTokens, percentUsed })

  return {
    total,
    window,
    autocompactBuffer,
    free,
    percentUsed,
    categories,
    preFirstTurn,
    tip,
  }
}

const SKILLS_TIP_THRESHOLD_TOKENS = 20_000

function buildTip(args: {
  skills: { tokens: number; count: number }
  skillsMode: 'off' | 'user' | 'project' | 'local'
  toolExchangesTokens: number
  percentUsed: number
}): string | undefined {
  const { skills, skillsMode, toolExchangesTokens, percentUsed } = args

  if (skills.tokens >= SKILLS_TIP_THRESHOLD_TOKENS) {
    const kTokens = Math.round(skills.tokens / 1000)
    if (skillsMode === 'local') {
      return `Skills use ~${kTokens}k tokens across ${skills.count} files. Settings → AI → Skills Mode: switch to "User + Project" or "User only" to drop local-scope skill bundles from the prompt.`
    }
    if (skillsMode === 'project') {
      return `Skills use ~${kTokens}k tokens across ${skills.count} files. Settings → AI → Skills Mode: switch to "User only" to drop project-scope skill bundles.`
    }
    if (skillsMode === 'user') {
      return `Skills use ~${kTokens}k tokens across ${skills.count} files. Settings → AI → Skills Mode: set to "Disabled" if you don't invoke them; or disable unused plugins to trim ~/.claude/plugins/ discovery.`
    }
  }

  if (toolExchangesTokens >= 50_000) {
    return `Tool exchanges take ~${Math.round(toolExchangesTokens / 1000)}k tokens. Run /compact to summarize earlier turns, or /clear to drop the history without summary.`
  }

  if (percentUsed >= 80) {
    return `Over 80 % of the window used. Run /compact soon — past that, you risk hitting the token limit mid-turn.`
  }

  return undefined
}

function emptyBreakdown(): ContextBreakdown {
  return {
    total: 0,
    window: 200_000,
    autocompactBuffer: 6_000,
    free: 194_000,
    percentUsed: 0,
    categories: [],
    preFirstTurn: true,
  }
}
