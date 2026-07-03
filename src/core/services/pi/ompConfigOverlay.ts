// Per-run omp `--config` overlay builder.
//
// omp accepts one or more `--config <file>.yml` overlays that layer on top of
// the user's global config for a single run. We use one overlay to enforce two
// app-side settings the omp RPC subprocess would otherwise not know about:
//
//   1. `pi_disabledExtensions` (item 5) → `disabledExtensions: [...]`
//   2. per-tool approval policy (items 2/4) → `tools.approval.<tool>: prompt|allow|deny`
//
// CRITICAL — a `--config` overlay REPLACES array-valued settings, it does NOT
// merge them. Writing a partial `disabledExtensions` would silently drop the
// user's global disable list (empirically ~26 entries). So the overlay's
// `disabledExtensions` MUST be the full UNION of omp's effective list + the
// app's ids, and MUST be omitted entirely whenever the effective read fails
// (we cannot safely author a partial list). Approval keys are independent of
// the read and are always written when present.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createLogger, errToCtx } from '../../utils/logger'

const log = createLogger('pi.ompConfigOverlay')

const execFileP = promisify(execFile)

/** omp resource-id prefixes that are already fully-qualified ids over RPC. */
const KNOWN_OMP_ID_PREFIXES = ['skill:', 'mcp:', 'slash-command:', 'extension-module:']

export type ApprovalPolicy = 'prompt' | 'allow' | 'deny'

export interface BuildOmpConfigOverlayOptions {
  ompPath: string
  disabledExtensionIds: string[]
  approval: Record<string, ApprovalPolicy>
}

export interface OmpConfigOverlay {
  configPath: string
  cleanup: () => void
}

// ─── effective disabledExtensions read (cached) ──────────────────────────────
// `omp config get disabledExtensions --json` costs ~0.7s per spawn. This is read
// once per turn, so cache by ompPath with a short TTL (mirrors ompCommands.ts).

interface DisabledCacheEntry { at: number; value: string[] }
const disabledCache = new Map<string, DisabledCacheEntry>()
const DISABLED_TTL_MS = 30_000

function parseDisabledValue(raw: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) return null
  const value = parsed.value
  if (!Array.isArray(value)) return null
  return value.filter((x): x is string => typeof x === 'string')
}

/**
 * Read omp's effective `disabledExtensions` list. Returns `null` (NOT `[]`) on
 * any failure so the caller can distinguish "genuinely empty global list" from
 * "could not read" — and MUST NOT clobber the user's global list on failure.
 */
export async function readEffectiveDisabledExtensions(ompPath: string): Promise<string[] | null> {
  const now = Date.now()
  const hit = disabledCache.get(ompPath)
  if (hit && now - hit.at < DISABLED_TTL_MS) return hit.value

  try {
    const { stdout } = await execFileP(ompPath, ['config', 'get', 'disabledExtensions', '--json'], {
      timeout: 15_000,
      maxBuffer: 4_000_000,
    })
    const value = parseDisabledValue(stdout)
    if (value === null) {
      log.warn('could not parse omp disabledExtensions --json output')
      return null
    }
    disabledCache.set(ompPath, { at: now, value })
    return value
  } catch (err) {
    log.warn('failed to read omp effective disabledExtensions', errToCtx(err))
    return null
  }
}

/**
 * Map app-side disabled ids to omp resource ids. An id already carrying a known
 * omp prefix passes through unchanged; a bare id (a command/extension name) is
 * prefixed with `extension-module:`. Deduped, order-preserving.
 */
export function mapAppDisabledToOmpIds(ids: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (!trimmed) continue
    const mapped = KNOWN_OMP_ID_PREFIXES.some((p) => trimmed.startsWith(p))
      ? trimmed
      : `extension-module:${trimmed}`
    if (!seen.has(mapped)) {
      seen.add(mapped)
      out.push(mapped)
    }
  }
  return out
}

// ─── YAML emission ───────────────────────────────────────────────────────────
// The overlay shape is fixed: an optional string[] under `disabledExtensions`
// and an optional nested string-map under `tools.approval`. JSON scalars are
// valid YAML, so `JSON.stringify` produces safely-quoted leaf values without a
// YAML dependency.

function emitOverlayYaml(disabled: string[] | undefined, approval: Record<string, ApprovalPolicy>): string {
  const lines: string[] = []
  if (disabled) {
    lines.push('disabledExtensions:')
    if (disabled.length === 0) {
      // Preserve the "empty list, not absent" semantics explicitly.
      lines[lines.length - 1] = 'disabledExtensions: []'
    } else {
      for (const id of disabled) lines.push(`  - ${JSON.stringify(id)}`)
    }
  }
  const approvalKeys = Object.keys(approval)
  if (approvalKeys.length > 0) {
    lines.push('tools:')
    lines.push('  approval:')
    for (const key of approvalKeys) lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(approval[key])}`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Build a per-run omp `--config` overlay enforcing the app's disabled-extension
 * and per-tool-approval settings. Returns `null` when there is nothing to
 * enforce (no disabled ids AND no approval overrides).
 *
 * On a failed effective-disabledExtensions read the `disabledExtensions` key is
 * OMITTED (item-5 enforcement degrades for this turn) rather than written
 * partial — a partial list would replace and thereby drop the user's global
 * disable list. Approval keys are always written when present.
 */
export async function buildOmpConfigOverlay(opts: BuildOmpConfigOverlayOptions): Promise<OmpConfigOverlay | null> {
  const { ompPath, disabledExtensionIds, approval } = opts
  const hasDisabled = disabledExtensionIds.length > 0
  const hasApproval = Object.keys(approval).length > 0
  if (!hasDisabled && !hasApproval) return null

  let disabledUnion: string[] | undefined
  if (hasDisabled) {
    const eff = await readEffectiveDisabledExtensions(ompPath)
    if (eff === null) {
      // Read failed — omit disabledExtensions entirely to avoid clobbering the
      // user's global list. Enforcement of item 5 is skipped for this turn.
      log.warn('omitting disabledExtensions from overlay (effective read failed) to avoid clobbering global list')
      disabledUnion = undefined
    } else {
      const appIds = mapAppDisabledToOmpIds(disabledExtensionIds)
      disabledUnion = Array.from(new Set([...eff, ...appIds]))
    }
  }

  if (!disabledUnion && !hasApproval) return null

  const yaml = emitOverlayYaml(disabledUnion, approval)
  const configPath = join(tmpdir(), `omp-overlay-${randomUUID()}.yml`)
  writeFileSync(configPath, yaml)
  return {
    configPath,
    cleanup: () => {
      try {
        unlinkSync(configPath)
      } catch {
        // already gone — ignore
      }
    },
  }
}

/** Clear the effective-disabledExtensions cache (tests + explicit refresh). */
export function clearOmpOverlayCache(): void {
  disabledCache.clear()
}
