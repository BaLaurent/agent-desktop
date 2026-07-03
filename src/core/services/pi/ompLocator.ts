// Locate the `omp` (Oh My Pi) binary for the RPC subprocess backend.
//
// omp is shipped as a standalone compiled binary (embeds its own Bun runtime),
// so we only need its path — no `bun` on PATH is required to run it. Resolution
// order: `PI_OMP_PATH` env override → `omp` on PATH → a managed fallback path
// set by the main-process sidecar (see main/services/ompSidecar.ts). The
// fallback keeps this module electron-free (headless-safe) — the sidecar injects
// the managed binary path via `setOmpFallbackPath`.

import { findBinaryInPath } from '../../utils/env'
import { createLogger } from '../../utils/logger'

const log = createLogger('ompLocator')

let _cached: string | null | undefined
let _fallback: string | null = null

/** Clear the cached lookup (tests). */
export function resetOmpPathCache(): void {
  _cached = undefined
}

/**
 * Register a managed fallback binary path (the downloaded sidecar). Used only
 * when neither `PI_OMP_PATH` nor a PATH `omp` resolves. Resets the cache so the
 * next lookup picks it up.
 */
export function setOmpFallbackPath(p: string | null): void {
  _fallback = p
  _cached = undefined
}

/**
 * Resolve the absolute path to the `omp` binary, or null if not found.
 * Order: `PI_OMP_PATH` env override → managed fallback → `omp` on PATH.
 *
 * The managed fallback outranks bare PATH because the sidecar sets it ONLY after
 * an authoritative supported-range check: when a PATH omp is in range the sidecar
 * clears the fallback (PATH wins); when PATH omp is out of range (e.g. the user's
 * global omp auto-updated past the pinned major) the sidecar installs an in-range
 * managed binary and keeps the fallback set, so that in-range binary — not the
 * unsupported PATH one — is what streams spawn. `PI_OMP_PATH` always wins.
 */
export function findOmpBinary(): string | null {
  if (_cached !== undefined) return _cached

  const override = process.env.PI_OMP_PATH
  if (override) {
    const resolved = findBinaryInPath(override)
    if (resolved) {
      _cached = resolved
      return resolved
    }
    log.warn('PI_OMP_PATH set but not executable; falling back to managed/PATH', { override })
  }

  if (_fallback) {
    const resolved = findBinaryInPath(_fallback)
    if (resolved) {
      _cached = resolved
      return resolved
    }
  }

  _cached = findBinaryInPath('omp')
  if (!_cached) {
    log.warn('omp binary not found on managed fallback or PATH (install Oh My Pi or set PI_OMP_PATH)')
  }
  return _cached
}
