/**
 * Coverage for `findOmpBinary`/`resetOmpPathCache`: resolving the `omp`
 * binary path via `PI_OMP_PATH` override → PATH lookup, with in-process
 * caching. `findBinaryInPath` (the real filesystem probe) is mocked — no
 * real executable is touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { findBinaryInPath } = vi.hoisted(() => ({ findBinaryInPath: vi.fn() }))

vi.mock('../../utils/env', () => ({ findBinaryInPath }))

import { findOmpBinary, resetOmpPathCache } from './ompLocator'

const ORIGINAL_PI_OMP_PATH = process.env.PI_OMP_PATH

beforeEach(() => {
  findBinaryInPath.mockReset()
  resetOmpPathCache()
  delete process.env.PI_OMP_PATH
})

afterEach(() => {
  if (ORIGINAL_PI_OMP_PATH === undefined) delete process.env.PI_OMP_PATH
  else process.env.PI_OMP_PATH = ORIGINAL_PI_OMP_PATH
  resetOmpPathCache()
})

describe('findOmpBinary', () => {
  it('resolves via PI_OMP_PATH when set and executable-resolvable', () => {
    process.env.PI_OMP_PATH = '/custom/omp'
    findBinaryInPath.mockReturnValue('/custom/omp')

    const result = findOmpBinary()

    expect(result).toBe('/custom/omp')
    expect(findBinaryInPath).toHaveBeenCalledWith('/custom/omp')
    expect(findBinaryInPath).not.toHaveBeenCalledWith('omp')
  })

  it('falls back to PATH lookup for "omp" when PI_OMP_PATH is unset', () => {
    findBinaryInPath.mockReturnValue('/usr/local/bin/omp')

    const result = findOmpBinary()

    expect(result).toBe('/usr/local/bin/omp')
    expect(findBinaryInPath).toHaveBeenCalledWith('omp')
  })

  it('falls back to PATH lookup when PI_OMP_PATH is set but not resolvable', () => {
    process.env.PI_OMP_PATH = '/bad/omp'
    findBinaryInPath.mockImplementation((name: string) => (name === 'omp' ? '/usr/bin/omp' : null))

    const result = findOmpBinary()

    expect(result).toBe('/usr/bin/omp')
    expect(findBinaryInPath).toHaveBeenCalledWith('/bad/omp')
    expect(findBinaryInPath).toHaveBeenCalledWith('omp')
  })

  it('returns null when neither PI_OMP_PATH nor PATH resolve', () => {
    findBinaryInPath.mockReturnValue(null)

    expect(findOmpBinary()).toBeNull()
  })

  it('caches the result across calls until resetOmpPathCache() is invoked', () => {
    findBinaryInPath.mockReturnValue('/usr/bin/omp')

    expect(findOmpBinary()).toBe('/usr/bin/omp')
    expect(findOmpBinary()).toBe('/usr/bin/omp')
    expect(findBinaryInPath).toHaveBeenCalledTimes(1)

    findBinaryInPath.mockReturnValue('/different/omp')
    expect(findOmpBinary()).toBe('/usr/bin/omp') // still cached, stale mock return ignored

    resetOmpPathCache()
    expect(findOmpBinary()).toBe('/different/omp')
    expect(findBinaryInPath).toHaveBeenCalledTimes(2)
  })

  it('caches a null (not-found) result too, until reset', () => {
    findBinaryInPath.mockReturnValue(null)

    expect(findOmpBinary()).toBeNull()
    expect(findOmpBinary()).toBeNull()
    expect(findBinaryInPath).toHaveBeenCalledTimes(1)

    findBinaryInPath.mockReturnValue('/usr/bin/omp')
    resetOmpPathCache()
    expect(findOmpBinary()).toBe('/usr/bin/omp')
  })
})
