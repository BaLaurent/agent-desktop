import { describe, it, expect, beforeEach, vi } from 'vitest'
import path from 'path'
import { pathToFileURL } from 'url'

// Capture the handler registered with protocol.handle and stub net/app.
let handler: ((request: { url: string }) => Response | Promise<Response>) | null = null
// Real net.fetch returns a Promise<Response>; mirror that so the handler's .catch wrapper works.
const netFetch = vi.fn((url: string) => Promise.resolve({ __fetched: url } as unknown as Response))

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

import { registerModelProtocol } from './modelProtocol'

// Mirror ortDistDir's resolution (real installed package — robust to worktrees).
const ortDist = path.dirname(require.resolve('onnxruntime-web'))
const HOTWORD_DIR = '/tmp/custom-wakeword'

describe('agent-model protocol handler', () => {
  beforeEach(() => {
    netFetch.mockClear()
    handler = null
  })

  it('serves ORT artifacts from onnxruntime-web/dist', async () => {
    registerModelProtocol()
    const res = await handler!({ url: 'agent-model://ort/ort-wasm-simd-threaded.jsep.wasm' })
    expect(res).toEqual({ __fetched: pathToFileURL(path.join(ortDist, 'ort-wasm-simd-threaded.jsep.wasm')).href })
  })

  it('serves a custom wakeword file from the configured hotword-model directory', async () => {
    registerModelProtocol({ getHotwordModelDir: () => HOTWORD_DIR })
    await handler!({ url: 'agent-model://hotword-model/my_keyword.onnx' })
    expect(netFetch).toHaveBeenCalledWith(pathToFileURL(path.join(HOTWORD_DIR, 'my_keyword.onnx')).href)
  })

  it('returns a clean 404 when the file is missing (net.fetch rejects)', async () => {
    netFetch.mockReturnValueOnce(Promise.reject(new Error('net::ERR_FILE_NOT_FOUND')))
    registerModelProtocol()
    const res = (await handler!({ url: 'agent-model://hotword/melspectrogram.onnx' })) as Response
    expect(res.status).toBe(404)
  })

  it('rejects path traversal with 403 (encoded ../ survives URL normalization)', () => {
    registerModelProtocol({ getHotwordModelDir: () => HOTWORD_DIR })
    const res = handler!({ url: 'agent-model://hotword-model/%2e%2e%2f%2e%2e%2fetc%2fpasswd' }) as Response
    expect(res.status).toBe(403)
    expect(netFetch).not.toHaveBeenCalled()
  })

  it('returns 404 for the hotword-model host when no custom directory is configured', () => {
    registerModelProtocol({ getHotwordModelDir: () => null })
    const res = handler!({ url: 'agent-model://hotword-model/my_keyword.onnx' }) as Response
    expect(res.status).toBe(404)
    expect(netFetch).not.toHaveBeenCalled()
  })

  it('returns 404 for unknown hosts', () => {
    registerModelProtocol()
    const res = handler!({ url: 'agent-model://secrets/id_rsa' }) as Response
    expect(res.status).toBe(404)
    expect(netFetch).not.toHaveBeenCalled()
  })
})
