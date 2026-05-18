// Cross-backend model-id adaptation.
//
// The Claude Agent SDK and the PI Coding Agent use different model-id
// conventions:
//   - Claude SDK : `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`  (no `/`)
//   - PI         : `provider/id`, e.g. `anthropic/claude-3-5-haiku`,
//                  `openrouter/anthropic/claude-...`, `openai/gpt-4o`
//
// `ai_model` is a single shared setting. When the user switches
// `ai_sdkBackend`, the stored id stops matching the active SDK's
// convention and the SDK silently falls back to its default model.
//
// This module translates an id to the active backend's convention at the
// resolution seam, by FAMILY (haiku/sonnet/opus), without rewriting the
// stored setting (transparent + reversible).

import { MODEL_OPTIONS, DEFAULT_MODEL, HAIKU_MODEL } from '../types/constants'

export type SdkBackend = 'claude-agent-sdk' | 'pi'
export type ModelFamily = 'haiku' | 'sonnet' | 'opus'

const CLAUDE_BACKEND: SdkBackend = 'claude-agent-sdk'
const PI_BACKEND: SdkBackend = 'pi'

/**
 * Concrete Claude SDK id for a family, derived from the canonical
 * `MODEL_OPTIONS` list so this stays in sync with the model lineup.
 * `HAIKU_MODEL` / `DEFAULT_MODEL` guarantee a non-undefined result.
 */
function claudeIdForFamily(family: ModelFamily): string {
  const match = MODEL_OPTIONS.find((o) => o.value.toLowerCase().includes(family))
  if (match) return match.value
  return family === 'haiku' ? HAIKU_MODEL : DEFAULT_MODEL
}

/** Family keyword scan, lowercase — handles PI provider prefixes. */
export function detectModelFamily(id: string): ModelFamily | null {
  const s = id.toLowerCase()
  if (s.includes('haiku')) return 'haiku'
  if (s.includes('sonnet')) return 'sonnet'
  if (s.includes('opus')) return 'opus'
  return null
}

/**
 * Which backend's convention an id is written in.
 * `pi` if it carries a `provider/` prefix; `claude-agent-sdk` for a bare
 * `claude-*` id; `unknown` for anything else (free-text custom ids — left
 * untouched, the user typed them on purpose for the current backend).
 */
export function detectBackendConvention(id: string): SdkBackend | 'unknown' {
  if (!id) return 'unknown'
  if (id.includes('/')) return PI_BACKEND
  if (id.startsWith('claude-')) return CLAUDE_BACKEND
  return 'unknown'
}

/** Parse the persisted `ai_lastModelByBackend` JSON object. */
export function parseLastModelByBackend(json: string | undefined): Record<string, string> {
  if (!json) return {}
  try {
    const obj = JSON.parse(json)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export interface MapContext {
  /** Last natively-selected model per backend (fallback for non-mappable ids). */
  lastModelByBackend?: Record<string, string>
}

/**
 * Translate `modelId` to the convention of `targetBackend`. Pure and
 * idempotent. Fallback chain (explicit):
 *
 *   1. empty / `'custom'` sentinel        → unchanged (free-text path)
 *   2. native to targetBackend            → unchanged (idempotent)
 *   3. `unknown` convention (custom id)   → unchanged (respect user intent)
 *   4. opposite backend, family detected  → concrete id for that family
 *   5. opposite backend, no family        → lastModelByBackend[target] ?? default
 *
 * Claude→PI (step 4/5) is best-effort: `core` cannot enumerate PI's
 * dynamic catalog (the `core`/`main` boundary keeps `piModels.ts` out of
 * reach), so a bare Claude id is handed to PI's fuzzy `resolvePIModelObject`
 * provider search; its existing error path covers true misses.
 */
export function mapModelToBackend(
  modelId: string | undefined,
  targetBackend: string | undefined,
  ctx: MapContext = {},
): string | undefined {
  if (!modelId || modelId === 'custom') return modelId
  const target: SdkBackend = targetBackend === PI_BACKEND ? PI_BACKEND : CLAUDE_BACKEND
  const convention = detectBackendConvention(modelId)
  if (convention === target || convention === 'unknown') return modelId

  // `convention` is now the *opposite* concrete backend → adapt.
  const last = ctx.lastModelByBackend?.[target]

  if (target === CLAUDE_BACKEND) {
    // Only treat a family keyword as a Claude equivalent when the source
    // id is actually Anthropic (`anthropic/claude-...`). A non-Anthropic
    // PI model that merely contains "opus"/"sonnet"/"haiku" in its name
    // has no Claude equivalent → fall back instead of mis-mapping.
    const lower = modelId.toLowerCase()
    const isAnthropic = lower.includes('claude') || lower.includes('anthropic')
    const family = isAnthropic ? detectModelFamily(modelId) : null
    if (family) return claudeIdForFamily(family)
    return last || DEFAULT_MODEL
  }

  // target === PI: best-effort (see doc comment).
  return last || modelId
}
