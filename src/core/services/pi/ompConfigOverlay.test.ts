/**
 * Coverage for the per-run omp `--config` overlay builder. The key contracts:
 *   - the overlay's `disabledExtensions` is the UNION of omp's effective global
 *     list and the app's ids (a `--config` overlay REPLACES arrays, so a partial
 *     list would silently drop the user's global disable list);
 *   - on a failed effective read the `disabledExtensions` key is OMITTED entirely
 *     (fail-safe), while approval keys are still written;
 *   - the effective read is cached per ompPath (one spawn per turn).
 * `node:child_process` is mocked at the `execFile` boundary — no real omp spawn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import {
  readEffectiveDisabledExtensions,
  mapAppDisabledToOmpIds,
  buildOmpConfigOverlay,
  clearOmpOverlayCache,
} from './ompConfigOverlay'

/** promisify(execFile) invokes the mock callback-last with (err, { stdout, stderr }). */
function ok(stdout: string) {
  return (_f: string, _a: string[], _o: unknown, cb: (e: Error | null, r?: { stdout: string; stderr: string }) => void) =>
    cb(null, { stdout, stderr: '' })
}
function fail(err: Error) {
  return (_f: string, _a: string[], _o: unknown, cb: (e: Error | null) => void) => cb(err)
}

beforeEach(() => {
  execFileMock.mockReset()
  clearOmpOverlayCache()
})

describe('mapAppDisabledToOmpIds', () => {
  it('prefixes a bare id with extension-module: and passes already-prefixed ids through', () => {
    expect(mapAppDisabledToOmpIds(['foo'])).toEqual(['extension-module:foo'])
    expect(mapAppDisabledToOmpIds(['skill:y'])).toEqual(['skill:y'])
    expect(mapAppDisabledToOmpIds(['mcp:z', 'slash-command:s', 'extension-module:e'])).toEqual([
      'mcp:z',
      'slash-command:s',
      'extension-module:e',
    ])
  })

  it('dedupes, preserves order, and skips empty/whitespace ids', () => {
    expect(mapAppDisabledToOmpIds(['foo', '  ', '', 'foo', 'skill:y'])).toEqual(['extension-module:foo', 'skill:y'])
  })
})

describe('readEffectiveDisabledExtensions', () => {
  it('parses { value: string[] } from the omp config get output', async () => {
    execFileMock.mockImplementation(ok('{"key":"disabledExtensions","value":["skill:a","b"],"type":"array"}'))
    expect(await readEffectiveDisabledExtensions('omp')).toEqual(['skill:a', 'b'])
  })

  it('returns null (NOT []) on spawn failure, unparseable output, or a non-array value', async () => {
    execFileMock.mockImplementation(fail(new Error('boom')))
    expect(await readEffectiveDisabledExtensions('omp')).toBeNull()

    clearOmpOverlayCache()
    execFileMock.mockImplementation(ok('not json'))
    expect(await readEffectiveDisabledExtensions('omp')).toBeNull()

    clearOmpOverlayCache()
    execFileMock.mockImplementation(ok('{"value":"notarray"}'))
    expect(await readEffectiveDisabledExtensions('omp')).toBeNull()
  })

  it('caches per ompPath within the TTL (one spawn) and re-spawns after clearOmpOverlayCache', async () => {
    execFileMock.mockImplementation(ok('{"value":["a"]}'))
    expect(await readEffectiveDisabledExtensions('omp')).toEqual(['a'])
    expect(await readEffectiveDisabledExtensions('omp')).toEqual(['a'])
    expect(execFileMock).toHaveBeenCalledTimes(1)

    clearOmpOverlayCache()
    expect(await readEffectiveDisabledExtensions('omp')).toEqual(['a'])
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })
})

describe('buildOmpConfigOverlay', () => {
  it('returns null when there is nothing to enforce (empty disabled + empty approval)', async () => {
    const overlay = await buildOmpConfigOverlay({ ompPath: 'omp', disabledExtensionIds: [], approval: {} })
    expect(overlay).toBeNull()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('union-merges the effective list with the mapped app ids (no clobber)', async () => {
    execFileMock.mockImplementation(ok('{"value":["a"]}'))
    const overlay = await buildOmpConfigOverlay({ ompPath: 'omp', disabledExtensionIds: ['skill:x'], approval: {} })
    expect(overlay).not.toBeNull()

    const yaml = readFileSync(overlay!.configPath, 'utf8')
    expect(yaml).toMatch(/^disabledExtensions:/m)
    expect(yaml).toContain('"a"')
    expect(yaml).toContain('"skill:x"')

    overlay!.cleanup()
    expect(existsSync(overlay!.configPath)).toBe(false)
  })

  it('omits disabledExtensions entirely on a failed effective read but still writes approval keys', async () => {
    execFileMock.mockImplementation(fail(new Error('boom')))
    const overlay = await buildOmpConfigOverlay({
      ompPath: 'omp',
      disabledExtensionIds: ['skill:x'],
      approval: { write: 'prompt' },
    })
    expect(overlay).not.toBeNull()

    const yaml = readFileSync(overlay!.configPath, 'utf8')
    expect(yaml).not.toContain('disabledExtensions')
    expect(yaml).toContain('approval')
    expect(yaml).toContain('"write"')
    expect(yaml).toContain('"prompt"')

    overlay!.cleanup()
    expect(existsSync(overlay!.configPath)).toBe(false)
  })
})
