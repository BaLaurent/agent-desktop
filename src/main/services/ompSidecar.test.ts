/**
 * Coverage for the omp-sidecar PURE decision helpers (semver parsing, range
 * membership, latest-in-range selection, and the install/update/use decision).
 * The network/child-process side of `ensureOmpBinary` is deliberately NOT tested
 * here (that is an E2E harness concern). `electron` is mocked because the module
 * imports `app` at top level.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/x' } }))

import {
  parseSemver,
  parseVersionOutput,
  cmpSemver,
  isInSupportedRange,
  pickLatestInRange,
  decideOmpAction,
} from './ompSidecar'

describe('parseSemver', () => {
  it('parses an x.y.z string, tolerating a leading v', () => {
    expect(parseSemver('v16.2.13')).toEqual({ major: 16, minor: 2, patch: 13 })
    expect(parseSemver('16.2.13')).toEqual({ major: 16, minor: 2, patch: 13 })
  })

  it('returns null for a non-version string', () => {
    expect(parseSemver('nope')).toBeNull()
  })
})

describe('parseVersionOutput', () => {
  it('extracts the version from `omp --version` output', () => {
    expect(parseVersionOutput('omp/16.2.13')).toEqual({ major: 16, minor: 2, patch: 13 })
  })
})

describe('cmpSemver', () => {
  it('orders by major, then minor, then patch', () => {
    const v = parseSemver('16.2.13')!
    expect(cmpSemver(parseSemver('16.2.12')!, v)).toBe(-1)
    expect(cmpSemver(v, v)).toBe(0)
    expect(cmpSemver(parseSemver('16.3.0')!, v)).toBe(1)
    expect(cmpSemver(parseSemver('17.0.0')!, v)).toBe(1)
  })
})

describe('isInSupportedRange', () => {
  it('accepts versions within [16.2.0, 17.0.0) and rejects the rest', () => {
    expect(isInSupportedRange(parseSemver('16.2.0')!)).toBe(true)
    expect(isInSupportedRange(parseSemver('16.9.9')!)).toBe(true)
    expect(isInSupportedRange(parseSemver('17.0.0')!)).toBe(false)
    expect(isInSupportedRange(parseSemver('15.9.9')!)).toBe(false)
    expect(isInSupportedRange(parseSemver('16.1.9')!)).toBe(false)
  })
})

describe('pickLatestInRange', () => {
  it('returns the highest in-range tag and excludes out-of-range ones', () => {
    expect(pickLatestInRange(['v16.2.11', 'v16.2.13', 'v17.0.0', 'v15.1.0'])).toEqual({
      tag: 'v16.2.13',
      version: { major: 16, minor: 2, patch: 13 },
    })
  })

  it('returns null when nothing is in range', () => {
    expect(pickLatestInRange(['v17.0.0'])).toBeNull()
  })
})

describe('decideOmpAction', () => {
  const latest = { tag: 'v16.2.13', version: parseSemver('16.2.13')! }

  it('uses the PATH binary when it is in range (even if a newer in-range release exists)', () => {
    expect(
      decideOmpAction({ pathVersion: parseSemver('16.2.0')!, managedVersion: null, latestInRange: latest }),
    ).toEqual({ kind: 'use-path' })
  })

  it('installs the latest in-range release when the PATH binary is out of range and no managed binary exists', () => {
    expect(
      decideOmpAction({ pathVersion: parseSemver('17.0.0')!, managedVersion: null, latestInRange: latest }),
    ).toEqual({ kind: 'install', tag: 'v16.2.13' })
  })

  it('uses the managed binary when it already matches the latest in-range release', () => {
    expect(
      decideOmpAction({ pathVersion: null, managedVersion: parseSemver('16.2.13')!, latestInRange: latest }),
    ).toEqual({ kind: 'use-managed' })
  })

  it('updates the managed binary when it is older than the latest in-range release', () => {
    expect(
      decideOmpAction({ pathVersion: null, managedVersion: parseSemver('16.2.11')!, latestInRange: latest }),
    ).toEqual({ kind: 'update', tag: 'v16.2.13' })
  })

  it('returns none when there is no PATH binary, no managed binary, and nothing in range', () => {
    expect(decideOmpAction({ pathVersion: null, managedVersion: null, latestInRange: null })).toEqual({ kind: 'none' })
  })
})
