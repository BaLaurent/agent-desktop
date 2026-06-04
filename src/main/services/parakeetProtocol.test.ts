import { describe, it, expect, beforeEach, vi } from 'vitest'
import path from 'path'
import { pathToFileURL } from 'url'

// Capture the handler registered with protocol.handle and stub net/app.
let handler: ((request: { url: string }) => Response | Promise<Response>) | null = null
const netFetch = vi.fn((url: string) => ({ __fetched: url }) as unknown as Response)

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: (_scheme: string, h: (request: { url: string }) => Response | Promise<Response>) => {
      handler = h
    },
  },
  net: { fetch: (url: string) => netFetch(url) },
  app: { isPackaged: false, getAppPath: () => process.cwd() },
}))

import { registerModelProtocol } from './parakeetProtocol'

const ortDist = path.join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist')
const MANUAL_DIR = '/tmp/parakeet-model'

describe('agent-model protocol handler', () => {
  beforeEach(() => {
    netFetch.mockClear()
    handler = null
  })

  it('serves ORT artifacts from onnxruntime-web/dist', () => {
    registerModelProtocol(() => MANUAL_DIR)
    const res = handler!({ url: 'agent-model://ort/ort-wasm-simd-threaded.jsep.wasm' })
    expect(res).toEqual({ __fetched: pathToFileURL(path.join(ortDist, 'ort-wasm-simd-threaded.jsep.wasm')).href })
  })

  it('serves manual model files from the configured directory', () => {
    registerModelProtocol(() => MANUAL_DIR)
    handler!({ url: 'agent-model://model/vocab.txt' })
    expect(netFetch).toHaveBeenCalledWith(pathToFileURL(path.join(MANUAL_DIR, 'vocab.txt')).href)
  })

  it('rejects path traversal with 403 (encoded ../ survives URL normalization)', () => {
    registerModelProtocol(() => MANUAL_DIR)
    const res = handler!({ url: 'agent-model://model/%2e%2e%2f%2e%2e%2fetc%2fpasswd' }) as Response
    expect(res.status).toBe(403)
    expect(netFetch).not.toHaveBeenCalled()
  })

  it('returns 404 for the model host when no manual directory is configured', () => {
    registerModelProtocol(() => null)
    const res = handler!({ url: 'agent-model://model/vocab.txt' }) as Response
    expect(res.status).toBe(404)
    expect(netFetch).not.toHaveBeenCalled()
  })

  it('returns 404 for unknown hosts', () => {
    registerModelProtocol(() => MANUAL_DIR)
    const res = handler!({ url: 'agent-model://secrets/id_rsa' }) as Response
    expect(res.status).toBe(404)
    expect(netFetch).not.toHaveBeenCalled()
  })
})
