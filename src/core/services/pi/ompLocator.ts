// Locate the `omp` (Oh My Pi) binary for the RPC subprocess backend.
//
// omp is shipped as a standalone compiled binary (embeds its own Bun runtime),
// so we only need its path — no `bun` on PATH is required to run it. Dev-first:
// resolve from PATH (same precedent as the `claude` CLI via findBinaryInPath),
// with a `PI_OMP_PATH` env override for non-standard installs. A packaged-build
// sidecar path is deferred (see project backlog).

import { findBinaryInPath } from '../../utils/env'
import { createLogger } from '../../utils/logger'

const log = createLogger('ompLocator')

let _cached: string | null | undefined

/** Clear the cached lookup (tests). */
export function resetOmpPathCache(): void {
  _cached = undefined
}

/**
 * Resolve the absolute path to the `omp` binary, or null if not found.
 * Order: `PI_OMP_PATH` env override → `omp` on PATH.
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
    log.warn('PI_OMP_PATH set but not executable; falling back to PATH', { override })
  }

  _cached = findBinaryInPath('omp')
  if (!_cached) {
    log.warn('omp binary not found on PATH (install Oh My Pi or set PI_OMP_PATH)')
  }
  return _cached
}
