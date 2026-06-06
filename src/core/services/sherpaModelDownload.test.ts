import { describe, it, expect, vi, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'

const homedirMock = vi.hoisted(() => vi.fn())

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  homedirMock.mockImplementation(actual.homedir)
  return { ...actual, default: { ...actual, homedir: homedirMock }, homedir: homedirMock }
})

import { getModelsRoot, downloadPreset } from './sherpaModelDownload'

afterEach(() => vi.restoreAllMocks())

describe('getModelsRoot', () => {
  it('points under the home dir', () => {
    expect(getModelsRoot()).toBe(path.join(os.homedir(), '.agent-desktop', 'stt-models'))
  })
})

describe('downloadPreset', () => {
  it('throws on unknown preset id', async () => {
    await expect(downloadPreset('does-not-exist')).rejects.toThrow(/preset/i)
  })

  it('downloads each preset file and reports progress', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sherpa-dl-'))
    homedirMock.mockReturnValue(dir)
    const body = new Uint8Array([1, 2, 3])
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => String(body.length) },
      arrayBuffer: async () => body.buffer,
    })))
    const seen: number[] = []
    const out = await downloadPreset('parakeet-tdt-0.6b-v3-int8', (p) => seen.push(p.index))
    expect(out).toContain('parakeet-tdt-0.6b-v3-int8')
    expect(seen.length).toBeGreaterThan(0)
    const written = await fs.readdir(out)
    expect(written.length).toBeGreaterThan(0)
    await fs.rm(dir, { recursive: true, force: true })
  })
})
